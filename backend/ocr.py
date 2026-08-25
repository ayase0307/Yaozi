"""影片硬字幕 OCR。

以固定頻率擷取字幕區域，RapidOCR 在本機辨識文字，再把相鄰畫面中相同的
字幕合併成帶開始／結束時間的 Segment。OCR 結果可依版面存成單語或 text +
trans 雙語欄位；整個流程不會把影像送出電腦。
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import threading
import time
import traceback
import unicodedata
import uuid
from difflib import SequenceMatcher
from pathlib import Path

from . import storage

_jobs: dict[str, dict] = {}
_lock = threading.Lock()
_engine = None
_engine_lock = threading.Lock()

LAYOUTS = {"auto", "single", "bilingual_top", "bilingual_bottom"}


def available() -> bool:
    return importlib.util.find_spec("rapidocr") is not None and importlib.util.find_spec("cv2") is not None


def _file(pid: str) -> Path:
    return storage.project_dir(pid) / "ocr.json"


def _public(job: dict | None) -> dict:
    if job is None:
        return {"status": "idle", "progress": 0.0, "error": None}
    return {
        key: job.get(key)
        for key in (
            "status",
            "progress",
            "processed",
            "total",
            "segments",
            "error",
            "started_at",
            "options",
        )
    }


def get_state(pid: str) -> dict:
    with _lock:
        job = _jobs.get(pid)
        if job is not None:
            return _public(job)
    try:
        with _file(pid).open("r", encoding="utf-8") as fp:
            return json.load(fp)
    except (OSError, json.JSONDecodeError):
        return _public(None)


def _clean_options(raw: dict | None) -> dict:
    raw = raw or {}
    try:
        crop_top = min(max(float(raw.get("crop_top", 0.45)), 0.0), 0.9)
        crop_bottom = min(max(float(raw.get("crop_bottom", 0.98)), crop_top + 0.08), 1.0)
        sample_rate = min(max(float(raw.get("sample_rate", 2.0)), 0.5), 4.0)
    except (TypeError, ValueError):
        raise RuntimeError("OCR 掃描設定格式錯誤")
    layout = str(raw.get("layout") or "auto")
    if layout not in LAYOUTS:
        raise RuntimeError("不支援的 OCR 字幕版面")
    return {
        "crop_top": round(crop_top, 3),
        "crop_bottom": round(crop_bottom, 3),
        "sample_rate": sample_rate,
        "layout": layout,
        "use_trim": bool(raw.get("use_trim", True)),
    }


def start(pid: str, options: dict | None = None) -> dict:
    if not available():
        raise RuntimeError("OCR 元件尚未安裝，請重新執行 setup.bat")
    meta = storage.load_project(pid)
    if meta is None:
        raise RuntimeError("找不到專案")
    if not meta.get("has_video"):
        raise RuntimeError("純音訊檔沒有畫面，無法做 OCR")
    media = storage.project_dir(pid) / meta["media_file"]
    if not media.is_file():
        raise RuntimeError("找不到影片檔")
    cleaned = _clean_options(options)
    with _lock:
        existing = _jobs.get(pid)
        if existing and existing.get("status") == "running":
            raise RuntimeError("OCR 已在進行中")
        job = {
            "status": "running",
            "progress": 0.0,
            "processed": 0,
            "total": 0,
            "segments": 0,
            "error": None,
            "started_at": time.time(),
            "options": cleaned,
            "cancel": False,
        }
        _jobs[pid] = job
    threading.Thread(target=_run, args=(pid, media, meta, job), daemon=True).start()
    return _public(job)


def cancel(pid: str) -> None:
    with _lock:
        job = _jobs.get(pid)
        if job and job.get("status") == "running":
            job["cancel"] = True


def _get_engine():
    global _engine
    with _engine_lock:
        if _engine is None:
            from rapidocr import RapidOCR

            _engine = RapidOCR()
        return _engine


def _join_parts(parts: list[str]) -> str:
    out = ""
    for part in parts:
        part = re.sub(r"\s+", " ", part).strip()
        if not part:
            continue
        if out and out[-1].isascii() and out[-1].isalnum() and part[0].isascii() and part[0].isalnum():
            out += " "
        out += part
    return out.strip()


def _rows_from_result(result) -> list[dict]:
    items = []
    boxes = result.boxes if result.boxes is not None else []
    texts = result.txts if result.txts is not None else []
    scores = result.scores if result.scores is not None else []
    for box, text, score in zip(boxes, texts, scores):
        text = str(text).strip()
        score = float(score)
        if not text or score < 0.45:
            continue
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        items.append(
            {
                "text": text,
                "score": score,
                "x": min(xs),
                "cy": (min(ys) + max(ys)) / 2,
                "height": max(max(ys) - min(ys), 1.0),
            }
        )
    items.sort(key=lambda item: (item["cy"], item["x"]))
    rows: list[dict] = []
    for item in items:
        row = next(
            (
                candidate
                for candidate in reversed(rows)
                if abs(item["cy"] - candidate["cy"]) <= max(item["height"], candidate["height"]) * 0.55
            ),
            None,
        )
        if row is None:
            rows.append({"items": [item], "cy": item["cy"], "height": item["height"]})
        else:
            row["items"].append(item)
            count = len(row["items"])
            row["cy"] = (row["cy"] * (count - 1) + item["cy"]) / count
            row["height"] = max(row["height"], item["height"])
    for row in rows:
        row["items"].sort(key=lambda item: item["x"])
        row["text"] = _join_parts([item["text"] for item in row["items"]])
        row["score"] = sum(item["score"] for item in row["items"]) / len(row["items"])
    return [row for row in rows if row.get("text")]


def _script(text: str) -> str:
    counts = {"latin": 0, "han": 0, "kana": 0, "hangul": 0}
    for char in text:
        code = ord(char)
        if "LATIN" in unicodedata.name(char, ""):
            counts["latin"] += 1
        elif 0x3040 <= code <= 0x30FF:
            counts["kana"] += 1
        elif 0xAC00 <= code <= 0xD7AF:
            counts["hangul"] += 1
        elif 0x3400 <= code <= 0x9FFF:
            counts["han"] += 1
    if counts["kana"]:
        return "ja"
    if counts["hangul"]:
        return "ko"
    return max(counts, key=counts.get) if any(counts.values()) else "other"


def _split_rows(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    if len(rows) <= 1:
        return rows, []
    gaps = [rows[i + 1]["cy"] - rows[i]["cy"] for i in range(len(rows) - 1)]
    cut = max(range(len(gaps)), key=gaps.__getitem__) + 1
    return rows[:cut], rows[cut:]


def _combine_rows(rows: list[dict]) -> str:
    return _join_parts([row["text"] for row in rows])


def observation_from_rows(rows: list[dict], layout: str) -> dict | None:
    """把 OCR 文字列轉成單語或雙語觀測值。獨立函式方便用合成資料測試。"""
    if not rows:
        return None
    top, bottom = _split_rows(rows)
    bilingual = layout in ("bilingual_top", "bilingual_bottom")
    if layout == "auto" and bottom:
        bilingual = _script(_combine_rows(top)) != _script(_combine_rows(bottom))
    if not bilingual:
        text = _combine_rows(rows)
        return {"text": text, "trans": None, "score": sum(r["score"] for r in rows) / len(rows)} if text else None
    original_rows, translated_rows = (top, bottom) if layout != "bilingual_bottom" else (bottom, top)
    text = _combine_rows(original_rows)
    trans = _combine_rows(translated_rows)
    if not text:
        return None
    return {
        "text": text,
        "trans": trans or None,
        "score": sum(r["score"] for r in rows) / len(rows),
    }


def _normalize(text: str | None) -> str:
    text = unicodedata.normalize("NFKC", text or "").lower()
    return "".join(char for char in text if char.isalnum())


def _similar(a: dict, b: dict) -> bool:
    for key in ("text", "trans"):
        left, right = _normalize(a.get(key)), _normalize(b.get(key))
        if bool(left) != bool(right):
            return False
        if left and SequenceMatcher(None, left, right).ratio() < 0.86:
            return False
    return True


def observations_to_segments(observations: list[tuple[float, dict | None]], step: float, duration: float) -> list[dict]:
    """合併相鄰重複字幕。允許中間漏辨識一格，降低閃斷與時間軸碎片。"""
    runs: list[dict] = []
    current = None
    max_gap = step * 1.6
    for at, observed in observations:
        if observed is None:
            continue
        if current and at - current["last"] <= max_gap and _similar(current, observed):
            current["last"] = at
            current["seen"] += 1
            if observed["score"] > current["score"]:
                current.update(text=observed["text"], trans=observed.get("trans"), score=observed["score"])
            continue
        if current:
            runs.append(current)
        current = {**observed, "first": at, "last": at, "seen": 1}
    if current:
        runs.append(current)

    segments = []
    for run in runs:
        start = max(0.0, run["first"] - step / 2)
        end = min(duration, run["last"] + step / 2)
        if end - start < max(0.18, step * 0.45):
            continue
        segment = {
            "id": uuid.uuid4().hex[:10],
            "start": round(start, 3),
            "end": round(end, 3),
            "text": run["text"],
        }
        if run.get("trans"):
            segment["trans"] = run["trans"]
        segments.append(segment)
    return segments


def _run(pid: str, media: Path, meta: dict, job: dict) -> None:
    cap = None
    try:
        import cv2

        cap = cv2.VideoCapture(str(media))
        if not cap.isOpened():
            raise RuntimeError("無法開啟影片畫面")
        duration = float(meta.get("duration") or 0)
        if duration <= 0:
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
            frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            duration = frames / fps if fps > 0 else 0
        if duration <= 0:
            raise RuntimeError("讀不到影片長度")

        options = job["options"]
        start_at, end_at = 0.0, duration
        trim = meta.get("trim") if options["use_trim"] else None
        if trim:
            start_at, end_at = float(trim["start"]), float(trim["end"])
        step = 1.0 / options["sample_rate"]
        total = max(1, int((end_at - start_at) / step) + 1)
        job["total"] = total
        engine = _get_engine()
        observations: list[tuple[float, dict | None]] = []

        for index in range(total):
            if job["cancel"]:
                job["status"] = "canceled"
                return
            at = min(start_at + index * step, end_at)
            cap.set(cv2.CAP_PROP_POS_MSEC, at * 1000)
            ok, frame = cap.read()
            observed = None
            if ok and frame is not None:
                height, width = frame.shape[:2]
                y0 = int(height * options["crop_top"])
                y1 = max(y0 + 1, int(height * options["crop_bottom"]))
                crop = frame[y0:y1]
                if width > 1280:
                    scale = 1280 / width
                    crop = cv2.resize(crop, (1280, max(1, round(crop.shape[0] * scale))))
                result = engine(crop, text_score=0.45, box_thresh=0.45)
                observed = observation_from_rows(_rows_from_result(result), options["layout"])
            observations.append((at, observed))
            with _lock:
                job["processed"] = index + 1
                job["progress"] = round((index + 1) / total, 4)

        segments = observations_to_segments(observations, step, end_at)
        if not segments:
            raise RuntimeError("掃描完成，但指定區域沒有辨識到穩定字幕；請調整掃描區域或精度")
        old = storage.load_subtitles(pid)
        storage.backup_subtitles(pid)
        storage.save_subtitles(pid, {"version": 1, "segments": segments, "marks": old.get("marks", [])})
        with _lock:
            job.update(status="done", progress=1.0, segments=len(segments))
    except Exception as exc:
        traceback.print_exc()
        with _lock:
            if job.get("status") != "canceled":
                job.update(status="error", error=str(exc)[:500])
    finally:
        if cap is not None:
            cap.release()
        try:
            public = _public(job)
            tmp = _file(pid).with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as fp:
                json.dump(public, fp, ensure_ascii=False)
            os.replace(tmp, _file(pid))
        except OSError:
            traceback.print_exc()
