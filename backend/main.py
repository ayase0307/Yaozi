import asyncio
import shutil
import subprocess
import urllib.parse
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import (
    asr,
    burn,
    config,
    cuts,
    dictionary,
    exporter,
    fetcher,
    fonts,
    llm,
    storage,
    style,
    transcriber,
    translate,
    waveform,
)

MEDIA_EXTS = {
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".mts", ".m2ts",
    ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    storage.mark_stale_jobs_interrupted()

    # 瀏覽器拖影片進度條時會不斷掐斷串流連線,Windows 的 Proactor 迴圈
    # 每次都印一段 ConnectionResetError——無害但很吵,這裡吃掉它。
    loop = asyncio.get_running_loop()

    def quiet_handler(loop: asyncio.AbstractEventLoop, context: dict) -> None:
        if isinstance(context.get("exception"), ConnectionResetError):
            return
        loop.default_exception_handler(context)

    loop.set_exception_handler(quiet_handler)
    yield


app = FastAPI(title="咬字", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# 擋 DNS rebinding:只接受本機 Host,其他一律拒絕
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

# 擋 CSRF:跨站的「簡單請求」(如 multipart POST)不需 preflight 就會送達,
# 瀏覽器會帶上 Origin,非本站來源的寫入請求一律拒絕(無 Origin 的本機工具照常)。
_ALLOWED_ORIGINS = {
    f"http://127.0.0.1:{config.PORT}",
    f"http://localhost:{config.PORT}",
}


@app.middleware("http")
async def csrf_guard(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin not in _ALLOWED_ORIGINS:
            return JSONResponse({"detail": "跨站請求被拒"}, status_code=403)
    return await call_next(request)


def _get_project_or_404(pid: str) -> dict:
    meta = storage.load_project(pid)
    if meta is None:
        raise HTTPException(404, "找不到專案")
    return meta


@app.get("/api/health")
def health():
    ai = llm.provider_status()
    return {
        "ffmpeg": config.ffmpeg_available(),
        "claude": llm.find_claude() is not None,
        "codex": llm.find_codex() is not None,
        "ai_provider": ai["provider"],
    }


@app.get("/api/projects")
def list_projects():
    return storage.list_projects()


@app.post("/api/projects")
def create_project(file: UploadFile = File(...)):
    # 同步函式:FastAPI 會丟進 threadpool,大檔複製才不會卡住整個事件迴圈
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in MEDIA_EXTS:
        raise HTTPException(400, f"不支援的檔案格式:{suffix or '(無副檔名)'}")
    meta = storage.create_project(Path(file.filename).stem, suffix)
    dest = storage.project_dir(meta["id"]) / meta["media_file"]
    try:
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f, 1024 * 1024)
    except Exception:
        storage.delete_project(meta["id"])
        raise HTTPException(500, "檔案儲存失敗")
    transcriber.start_job(meta["id"])
    return storage.load_project(meta["id"])


@app.post("/api/projects/url")
def create_project_from_url(body: dict = Body(...)):
    url = (body.get("url") or "").strip()
    # 只放行 http(s):yt-dlp 也吃 file:// 之類的 scheme,不擋等於開了讀本機檔的後門
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "請貼 http/https 開頭的影片網址")
    if not fetcher.available():
        raise HTTPException(503, "找不到 yt-dlp,請重跑 setup.bat 安裝")
    try:
        return fetcher.start(url)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"讀取網址失敗:{str(e)[:200]}")


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    return _get_project_or_404(pid)


@app.patch("/api/projects/{pid}")
def patch_project(pid: str, body: dict = Body(...)):
    """改專案名或剪輯範圍。只送有帶的欄位,沒帶的不動。"""
    meta = _get_project_or_404(pid)
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "名稱不可為空")
        meta["name"] = name[:200]
    if "trim" in body:
        meta["trim"] = storage.clean_trim(body["trim"], meta.get("duration"))
    storage.save_project(meta)
    return meta


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    _get_project_or_404(pid)
    if transcriber.is_running(pid):
        raise HTTPException(409, "辨識進行中,無法刪除")
    storage.delete_project(pid)
    return {"ok": True}


@app.post("/api/projects/{pid}/transcribe")
def retranscribe(pid: str):
    meta = _get_project_or_404(pid)
    if not transcriber.start_job(pid):
        raise HTTPException(409, "辨識已在進行中")
    return storage.load_project(pid) or meta


@app.get("/api/projects/{pid}/subtitles")
def get_subtitles(pid: str):
    _get_project_or_404(pid)
    return storage.load_subtitles(pid)


@app.put("/api/projects/{pid}/subtitles")
def put_subtitles(pid: str, body: dict = Body(...)):
    _get_project_or_404(pid)
    segments = body.get("segments")
    if not isinstance(segments, list):
        raise HTTPException(400, "segments 必須是陣列")
    for s in segments:
        if not (isinstance(s, dict) and "start" in s and "end" in s and "text" in s):
            raise HTTPException(400, "字幕格式錯誤")
    marks = body.get("marks") or []
    if not (isinstance(marks, list) and all(isinstance(m, (int, float)) for m in marks)):
        raise HTTPException(400, "marks 必須是數字陣列")
    storage.save_subtitles(pid, {"version": 1, "segments": segments, "marks": marks})
    return {"ok": True}


@app.post("/api/resegment")
def resegment(body: dict = Body(...)):
    """把一批字幕重新斷句(合併碎片 + 切開長句),不動存檔。

    純轉換,前端拿回結果自己走復原系統存。這樣改斷句設定不必重跑一次辨識。
    """
    segments = body.get("segments")
    if not isinstance(segments, list):
        raise HTTPException(400, "segments 必須是陣列")
    for s in segments:
        if not (isinstance(s, dict) and "start" in s and "end" in s and "text" in s):
            raise HTTPException(400, "字幕格式錯誤")
    limit = body.get("split_chars")
    if limit is None:
        limit = asr.load()["split_chars"]
    return {"segments": transcriber.reflow(segments, int(limit))}


@app.post("/api/projects/{pid}/burn")
def start_burn(pid: str):
    _get_project_or_404(pid)
    try:
        return burn.start(pid)
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.get("/api/projects/{pid}/burn")
def get_burn(pid: str):
    _get_project_or_404(pid)
    return burn.get_state(pid)


@app.delete("/api/projects/{pid}/burn")
def cancel_burn(pid: str):
    _get_project_or_404(pid)
    burn.cancel(pid)
    return {"ok": True}


@app.get("/api/projects/{pid}/burn/file")
def get_burn_file(pid: str):
    meta = _get_project_or_404(pid)
    path = storage.project_dir(pid) / burn.OUT_NAME
    if not path.is_file():
        raise HTTPException(404, "還沒有匯出的影片")
    filename = urllib.parse.quote(f"{meta['name']}_字幕.mp4")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@app.get("/api/projects/{pid}/cuts")
def get_cuts(pid: str):
    _get_project_or_404(pid)
    return cuts.get_state(pid)


@app.post("/api/projects/{pid}/cuts")
def start_cuts(pid: str):
    _get_project_or_404(pid)
    try:
        return cuts.start(pid)
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.get("/api/dictionary")
def get_dictionary():
    return {"entries": dictionary.load()}


@app.post("/api/dictionary")
def add_dict_entry(body: dict = Body(...)):
    try:
        entries = dictionary.add(body.get("wrong") or "", body.get("right") or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"entries": entries}


@app.delete("/api/dictionary/{entry_id}")
def delete_dict_entry(entry_id: str):
    return {"entries": dictionary.remove(entry_id)}


@app.get("/api/fonts")
def list_fonts():
    return {"groups": fonts.grouped()}


# 副檔名 → MIME。認不得就當 TrueType,瀏覽器實際是看檔頭而不是這個值
_FONT_MIME = {
    ".ttf": "font/ttf", ".otf": "font/otf", ".ttc": "font/collection",
    ".otc": "font/collection", ".woff": "font/woff", ".woff2": "font/woff2",
}


@app.get("/api/fontfile")
def get_font_file(name: str):
    """把系統字型檔本身送給瀏覽器,前端用 @font-face 掛上去。

    只靠家族名讓瀏覽器自己找,認不出來的會默默掉回系統預設字(這台機器 424 個字型
    裡有 116 個是這樣)——使用者看到的就是「選了字型沒反應」。路徑一律由 fonts.py
    的註冊表對照表決定,不拿 name 去拼路徑。
    """
    path = fonts.file_for(name)
    if path is None or not any(path.is_relative_to(d) for d in fonts.FONT_DIRS):
        raise HTTPException(404, "找不到這個字型")
    return FileResponse(
        path,
        media_type=_FONT_MIME.get(path.suffix.lower(), "font/ttf"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/style")
def get_style():
    return style.load()


@app.put("/api/style")
def put_style(body: dict = Body(...)):
    return style.save(body)


@app.get("/api/asr")
def get_asr():
    return asr.load()


@app.put("/api/asr")
def put_asr(body: dict = Body(...)):
    return asr.save(body)


@app.get("/api/llm/status")
def llm_status():
    return {
        **llm.provider_status(),
        "languages": translate.LANGUAGES,
        "yt_dlp": fetcher.available(),
    }


@app.get("/api/ai")
def get_ai_settings():
    return llm.provider_status()


@app.put("/api/ai")
def put_ai_settings(body: dict = Body(...)):
    try:
        llm.save_settings(body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return llm.provider_status()


@app.post("/api/projects/{pid}/translate")
def start_translate(pid: str, body: dict = Body(...)):
    _get_project_or_404(pid)
    try:
        return translate.start(pid, (body.get("target") or "").strip())
    except RuntimeError as e:
        raise HTTPException(400, str(e))


@app.get("/api/projects/{pid}/translate")
def translate_state(pid: str):
    _get_project_or_404(pid)
    return translate.get_state(pid)


@app.delete("/api/projects/{pid}/translate")
def stop_translate(pid: str, clear: bool = False):
    _get_project_or_404(pid)
    if clear:
        return translate.clear(pid)
    translate.cancel(pid)
    return {"status": "idle"}


@app.post("/api/projects/{pid}/fix")
def start_fix(pid: str):
    _get_project_or_404(pid)
    try:
        return llm.start(pid)
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.get("/api/projects/{pid}/fix")
def get_fix(pid: str):
    _get_project_or_404(pid)
    return llm.get_state(pid)


@app.put("/api/projects/{pid}/fix")
def update_fix(pid: str, body: dict = Body(...)):
    _get_project_or_404(pid)
    suggestions = body.get("suggestions")
    if not isinstance(suggestions, list) or not all(
        isinstance(s, dict) and "id" in s and "old" in s and "new" in s for s in suggestions
    ):
        raise HTTPException(400, "suggestions 格式錯誤")
    llm.update_suggestions(pid, suggestions)
    return {"ok": True}


@app.delete("/api/projects/{pid}/fix")
def cancel_fix(pid: str):
    _get_project_or_404(pid)
    llm.cancel(pid)
    return {"ok": True}


@app.get("/api/projects/{pid}/waveform")
def get_waveform(pid: str):
    _get_project_or_404(pid)
    d = storage.project_dir(pid)
    f = d / "waveform.json"
    if not f.is_file():
        wav = d / "audio.wav"
        if not wav.is_file():
            raise HTTPException(404, "找不到音軌,請重新辨識一次")
        waveform.generate(wav, f)
    return FileResponse(f, media_type="application/json")


@app.get("/api/projects/{pid}/media")
def get_media(pid: str):
    meta = _get_project_or_404(pid)
    path = storage.project_dir(pid) / meta["media_file"]
    if not path.is_file():
        raise HTTPException(404, "找不到媒體檔")
    return FileResponse(path)


@app.get("/api/projects/{pid}/thumb")
def get_thumb(pid: str):
    """專案卡的縮圖。第一次要的時候才抽,抽完存成 thumb.jpg 重複用;純音檔沒有畫面。"""
    meta = _get_project_or_404(pid)
    d = storage.project_dir(pid)
    thumb = d / "thumb.jpg"
    if not thumb.is_file():
        if meta.get("has_video") is False:
            raise HTTPException(404, "純音檔沒有畫面")
        media = d / meta["media_file"]
        if not media.is_file():
            raise HTTPException(404, "找不到媒體檔")
        # 取 10% 處:開頭常常是黑畫面或片頭卡,抽出來一片黑等於沒抽
        at = max((meta.get("duration") or 0) * 0.1, 0)
        subprocess.run(
            [config.FFMPEG, "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", str(media),
             "-frames:v", "1", "-vf", "scale=360:-2", str(thumb)],
            capture_output=True, timeout=60,
        )
        if not thumb.is_file():
            raise HTTPException(404, "抽不出畫面")
    return FileResponse(thumb, media_type="image/jpeg")


@app.get("/api/projects/{pid}/export")
def export_subtitles(pid: str, format: str = "srt"):
    meta = _get_project_or_404(pid)
    subs = storage.load_subtitles(pid)
    # 有設剪輯範圍就跟著裁,不然匯出的字幕會對不上剪過的成品影片
    segments = storage.apply_trim(subs["segments"], meta.get("trim"))
    try:
        filename, content, mime = exporter.export(segments, format, meta["name"])
    except ValueError as e:
        raise HTTPException(400, str(e))
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{urllib.parse.quote(filename)}"
    }
    return Response(content=content, media_type=mime, headers=headers)


if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="static")
