import json
import math
import re
import subprocess
import threading
import traceback
import unicodedata
import uuid
from difflib import SequenceMatcher

from . import asr, config, storage

# Whisper 訓練資料裡混進了大量字幕組水印,聽不到人聲時就會把這些整句吐出來。
# 只列真人講話幾乎不可能講的字串,免得誤刪正常字幕。
_HALLUCINATION = re.compile(
    r"Amara\.org|字幕(志願|志愿)者|明鏡|明镜|點點欄目|点点栏目"
    r"|不吝(點贊|点赞)|訂閱\s*轉發\s*打賞|订阅\s*转发\s*打赏"
    r"|Subtitles by the|字幕by|MBC\s*뉴스",
    re.IGNORECASE,
)

_model = None
_model_device = None
_model_lock = threading.Lock()
_transcribe_lock = threading.Lock()  # 一次只跑一個辨識,後來的排隊
_force_cpu = False
_running: set[str] = set()
_running_lock = threading.Lock()

_cc = None


def is_running(pid: str) -> bool:
    with _running_lock:
        return pid in _running


def start_job(pid: str) -> bool:
    with _running_lock:
        if pid in _running:
            return False
        _running.add(pid)
    threading.Thread(target=_run, args=(pid,), daemon=True).start()
    return True


def _update(meta: dict, **kw) -> None:
    meta.update(kw)
    storage.save_project(meta)


def _probe(media) -> tuple[float, bool]:
    out = subprocess.run(
        [config.FFPROBE, "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", str(media)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if out.returncode != 0:
        raise RuntimeError(f"ffprobe 讀取失敗:{out.stderr.strip()[-300:]}")
    info = json.loads(out.stdout)
    duration = float(info.get("format", {}).get("duration") or 0.0)
    has_video = any(
        s.get("codec_type") == "video" and s.get("codec_name") not in ("mjpeg", "png", "bmp", "gif")
        for s in info.get("streams", [])
    )
    return duration, has_video


def _extract_audio(media, wav) -> None:
    out = subprocess.run(
        [config.FFMPEG, "-y", "-v", "error", "-i", str(media),
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if out.returncode != 0:
        raise RuntimeError(f"ffmpeg 抽取音軌失敗:{out.stderr.strip()[-300:]}")


def _get_model(status_cb):
    global _model, _model_device, _force_cpu
    with _model_lock:
        if _model is None:
            status_cb()
            config.setup_cuda_dlls()
            from faster_whisper import WhisperModel
            config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
            root = str(config.MODELS_DIR)
            if not _force_cpu:
                try:
                    _model = WhisperModel(
                        config.MODEL_NAME, device="cuda", compute_type="float16",
                        download_root=root,
                    )
                    _model_device = "cuda"
                except Exception as e:
                    print(f"[yaozi] CUDA 初始化失敗,改用 CPU:{e}")
                    _force_cpu = True
            if _model is None:
                _model = WhisperModel(
                    config.MODEL_NAME, device="cpu", compute_type="int8",
                    download_root=root,
                )
                _model_device = "cpu"
        return _model, _model_device


def _reset_model_to_cpu() -> None:
    global _model, _force_cpu
    with _model_lock:
        _model = None
        _force_cpu = True


def _transcribe(meta: dict, audio, duration: float) -> list[dict]:
    model, device = _get_model(lambda: _update(meta, status="loading_model"))
    _update(meta, status="transcribing", progress=0.0, device=device)

    opts = asr.load()
    lang = None if opts["language"] == "auto" else opts["language"]
    prompt = opts["prompt"]
    if lang == "zh":
        prompt = ("以下是繁體中文的內容。" + prompt).strip()

    seg_iter, info = model.transcribe(
        str(audio),
        language=lang,
        word_timestamps=True,
        initial_prompt=prompt or None,
        vad_filter=opts["vad"],
        vad_parameters={"threshold": opts["vad_threshold"], "min_silence_duration_ms": 500},
        # 下面三個是幻覺防護。沒有它們,遇到純音樂/長靜音時 Whisper 會照著訓練資料
        # 掰出「字幕由 Amara.org 社群提供」這類水印,而且會一路複製到下一段。
        condition_on_previous_text=False,
        hallucination_silence_threshold=2.0,
        no_speech_threshold=0.6,
    )
    segments = []
    for s in seg_iter:
        text = s.text.strip()
        if not text or _HALLUCINATION.search(text):
            continue
        segments.append({
            "id": uuid.uuid4().hex[:8],
            "start": round(s.start, 3),
            "end": round(s.end, 3),
            "text": text,
            "words": [
                {"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word}
                for w in (s.words or [])
            ],
        })
        if duration > 0:
            meta["progress"] = min(round(s.end / duration, 3), 0.99)
        if len(segments) % 5 == 0:
            storage.save_project(meta)
    meta["language"] = info.language
    return reflow(segments, opts["split_chars"])


# 斷句優先挑這些字後面。句末標點比子句標點值錢,沒標點才退而求其次找最長的停頓。
_SENT_END = "。？！?!…"
_CLAUSE_END = "，、；：,;:」』）】"

# 合併用的兩道閘。只管合併不管切開——字數夠短卻拖很久的句子(唱歌拉長音、
# Whisper 對著靜音吐出來的「5つ」佔了 85 秒)硬切只會切出更看不懂的碎片,
# 該修的是那句的結束時間,不是把它剁成兩半。
MAX_DUR = 7.0  # 合併後最長幾秒:超過就不黏,免得整句黏到那種病態長段上
MAX_GAP = 0.6  # 相鄰兩句間隔超過這麼久就當作換句,不合併


def _width(text: str) -> int:
    """字寬:全形算 2、半形算 1。

    「一句 24 字」對中文剛好一行,對英文卻只有四五個單字——同一個設定值要同時
    管兩種語言,只能改用字寬。24 全形字 = 48 個英文字母,接近 Netflix 的每行 42。
    """
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in text)


def _join(a: str, b: str) -> str:
    """接兩段文字:兩邊都是半形才補空白,中文接中文不能有空隙。"""
    sep = " " if a[-1:].isascii() and b[:1].isascii() else ""
    return (a + sep + b).strip()


def reflow(segments: list[dict], limit: int) -> list[dict]:
    """重新斷句:先把碎片黏回完整句子,再把過長的句子切開。

    Whisper 給的一「段」長短完全看它自己高興——安靜一點就斷成兩三個字的碎片
    (「how」、「產む声を」),一口氣講完又能吐出兩百字。只切不合,碎片永遠是碎片;
    只合不切,長句照樣讀不完。兩件事一起做才會得到「看得懂的一句」。
    """
    if limit <= 0:
        return segments
    limit_w = limit * 2  # 設定值是全形字數,內部一律換算成字寬
    return _split_long(_merge_short(segments, limit_w), limit_w)


def _merge_short(segments: list[dict], limit_w: int) -> list[dict]:
    """把接得上的相鄰句子黏成一句。

    黏的條件:中間沒有明顯停頓、上一句沒有句號收尾、黏完長度與秒數都還在上限內。
    句末標點是最強的訊號——那裡本來就是一句話的結尾,再怎麼靠近也不該併。
    """
    out: list[dict] = []
    for seg in segments:
        prev = out[-1] if out else None
        if (
            prev is not None
            and seg["start"] - prev["end"] <= MAX_GAP
            and prev["text"].rstrip()[-1:] not in _SENT_END
            and _width(prev["text"]) + _width(seg["text"]) <= limit_w
            and seg["end"] - prev["start"] <= MAX_DUR
        ):
            prev["end"] = seg["end"]
            prev["text"] = _join(prev["text"], seg["text"])
            prev["words"] = (prev.get("words") or []) + (seg.get("words") or [])
            # 譯文沒有單字時間戳,切不開,但至少不能在合併時弄丟半句
            if seg.get("trans"):
                prev["trans"] = _join(prev.get("trans") or "", seg["trans"])
            continue
        out.append({**seg, "words": list(seg.get("words") or [])})
    return out


def _pos_map(src: str, dst: str) -> list[int]:
    """src 的每個位置對應到 dst 的哪個位置(長度 len(src)+1)。

    單字時間戳是 Whisper 的原始輸出,但 text 早就被簡繁轉換、詞庫、AI 校正改過
    (「co-work」被詞庫換成「Claude」)。直接拿單字重組文字會把這些修正洗掉,
    所以切點在單字文字裡算,再對映回真正的 text 上去切。
    """
    m = [0] * (len(src) + 1)
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, src, dst, autojunk=False).get_opcodes():
        for k in range(i1, i2):
            m[k] = j1 + (k - i1) if tag == "equal" else j1
        m[i2] = j2
    return m


def _split_long(segments: list[dict], limit_w: int) -> list[dict]:
    """把過長的句子照單字時間戳切開,盡量切成等長的幾段。

    重點是「等長」:先算出這句至少得分成幾段(n),再瞄準 1/n 的位置下刀。
    早期版本是從三成長度開始找分數最高的切點,英文字與字之間的停頓又細又雜,
    結果每次都在很前面就切掉,一句 100 字被剁成八九個「and how much」這種碎片。
    """
    out: list[dict] = []
    queue = list(segments)
    while queue:
        seg = queue.pop(0)
        words = seg.get("words") or []
        text = seg["text"]
        w = _width(text)
        # 沒有單字時間戳就切不準,寧可留著長句也不要時間軸錯位
        if len(words) < 2 or w <= limit_w:
            out.append(seg)
            continue
        pos_map = _pos_map("".join(x["word"] for x in words), text)
        n = max(math.ceil(w / limit_w), 2)
        target = w / n
        best, best_score = None, None
        prefix = 0
        for i in range(1, len(words)):
            prefix += len(words[i - 1]["word"])
            pos = pos_map[prefix]
            left = text[:pos].strip()
            lw = _width(left)
            # 上限是硬的(切完不能還超長),下限只是別切出太小的碎片
            if lw > limit_w or lw < target * 0.55:
                continue
            last = left[-1:]
            score = (
                -abs(lw - target) / target
                + (1.2 if last in _SENT_END else 0.6 if last in _CLAUSE_END else 0.0)
                + min(words[i]["start"] - words[i - 1]["end"], 0.5)
            )
            if best_score is None or score > best_score:
                best, best_score = (i, pos), score
        if best is None:
            out.append(seg)
            continue
        i, pos = best
        head, tail = text[:pos].strip(), text[pos:].strip()
        if not head or not tail:
            out.append(seg)
            continue
        cut = round((words[i - 1]["end"] + words[i]["start"]) / 2, 3)
        out.append({**seg, "end": cut, "text": head, "words": words[:i]})
        # 尾巴放回佇列,還太長就繼續切
        queue.insert(0, {
            "id": uuid.uuid4().hex[:8],
            "start": cut,
            "end": seg["end"],
            "text": tail,
            "words": words[i:],
        })
    return out


def _to_traditional(segments: list[dict]) -> list[dict]:
    global _cc
    if _cc is None:
        from opencc import OpenCC
        _cc = OpenCC("s2twp")
    for s in segments:
        s["text"] = _cc.convert(s["text"])
        for w in s.get("words", []):
            w["word"] = _cc.convert(w["word"])
    return segments


def _run(pid: str) -> None:
    meta = storage.load_project(pid)
    if meta is None:
        with _running_lock:
            _running.discard(pid)
        return
    d = storage.project_dir(pid)
    try:
        _update(meta, status="extracting", progress=0.0, error=None)
        media = d / meta["media_file"]
        duration, has_video = _probe(media)
        _update(meta, duration=duration, has_video=has_video)

        audio = d / "audio.wav"
        _extract_audio(media, audio)

        try:
            from . import waveform
            waveform.generate(audio, d / "waveform.json")
        except Exception:
            traceback.print_exc()  # 波形失敗不影響辨識,之後 API 會再試一次

        with _transcribe_lock:
            try:
                segments = _transcribe(meta, audio, duration)
            except Exception:
                if _model_device == "cuda":
                    # GPU 在辨識途中失敗(常見於 cuDNN 缺 DLL),換 CPU 重試一次
                    traceback.print_exc()
                    print("[yaozi] GPU 辨識失敗,改用 CPU 重試")
                    _reset_model_to_cpu()
                    segments = _transcribe(meta, audio, duration)
                else:
                    raise

        _update(meta, status="converting", progress=1.0)
        if (meta.get("language") or "").startswith("zh"):
            segments = _to_traditional(segments)

        # 套用詞庫(錯誤寫法 → 正確寫法)
        from . import dictionary
        entries = dictionary.load()
        if entries:
            for s in segments:
                s["text"] = dictionary.apply_text(s["text"], entries)

        storage.backup_subtitles(pid)  # 覆蓋前備份舊字幕(若有)
        storage.save_subtitles(pid, {"version": 1, "segments": segments})
        _update(meta, status="done", progress=1.0)
    except Exception as e:
        traceback.print_exc()
        try:
            _update(meta, status="error", error=str(e)[:500])
        except Exception:
            traceback.print_exc()
    finally:
        with _running_lock:
            _running.discard(pid)
