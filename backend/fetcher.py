"""貼網址抓影片。yt-dlp 下載完就當成一般專案丟進辨識流程。

下載是在背景執行緒跑的,專案一建好就先回傳,前端靠既有的輪詢看進度——
跟上傳大檔的體感一致,不用另外做一套狀態機。
"""

import threading
import traceback

from . import config, storage, transcriber

MAX_MINUTES = 180  # 三小時以上的多半是直播存檔,本機 CPU 跑不完


def available() -> bool:
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return False
    return True


def _opts(dest_stem: str) -> dict:
    return {
        # 先要 mp4,拿不到再退到最好的單一檔案;避免另外呼叫 ffmpeg 合流
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "outtmpl": dest_stem + ".%(ext)s",
        "merge_output_format": "mp4",
        "ffmpeg_location": config.FFMPEG,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }


def start(url: str) -> dict:
    """先探標題與長度,建好專案再背景下載。回傳專案 meta。"""
    import yt_dlp

    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get("_type") == "playlist":
        info = (info.get("entries") or [None])[0]
        if info is None:
            raise RuntimeError("這個網址裡沒有可下載的影片")
    duration = info.get("duration") or 0
    if duration > MAX_MINUTES * 60:
        raise RuntimeError(f"影片超過 {MAX_MINUTES} 分鐘,請先自行剪短再上傳")

    meta = storage.create_project(info.get("title") or "網路影片", ".mp4")
    meta["status"] = "downloading"
    storage.save_project(meta)
    threading.Thread(target=_run, args=(meta["id"], url), daemon=True).start()
    return meta


def _run(pid: str, url: str) -> None:
    import yt_dlp

    d = storage.project_dir(pid)
    try:
        with yt_dlp.YoutubeDL(_opts(str(d / "download"))) as ydl:
            ydl.download([url])
        got = next((p for p in d.glob("download.*") if p.is_file()), None)
        if got is None:
            raise RuntimeError("下載完成但找不到檔案")
        meta = storage.load_project(pid)
        if meta is None:
            return
        # 副檔名要等下載完才知道,這時才把 media_file 定案
        target = d / ("media" + got.suffix)
        got.replace(target)
        meta["media_file"] = target.name
        meta["status"] = "uploaded"
        storage.save_project(meta)
        transcriber.start_job(pid)
    except Exception as e:
        traceback.print_exc()
        meta = storage.load_project(pid)
        if meta is not None:
            meta["status"] = "error"
            meta["error"] = f"下載失敗:{str(e)[:300]}"
            storage.save_project(meta)
