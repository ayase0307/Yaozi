import json
import os
import shutil
import threading
import time
import uuid
from pathlib import Path

from . import config, timeline

RUNNING_STATUSES = {"downloading", "extracting", "loading_model", "transcribing", "converting"}

# Windows 上 os.replace 的目標檔若正被另一個執行緒讀取會拒絕存取,
# 所以所有 JSON 讀寫共用一把鎖,寫入失敗再小睡重試(擋外部程式如備份軟體)。
_io_lock = threading.Lock()


def project_dir(pid: str) -> Path:
    return config.PROJECTS_DIR / pid


def _load_json(path: Path, default=None):
    with _io_lock:
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return default


def _save_json(path: Path, data) -> None:
    with _io_lock:
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        for attempt in range(5):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                time.sleep(0.05 * (attempt + 1))
        os.replace(tmp, path)


def create_project(display_name: str, media_suffix: str) -> dict:
    pid = uuid.uuid4().hex[:12]
    d = project_dir(pid)
    d.mkdir(parents=True, exist_ok=True)
    meta = {
        "id": pid,
        "name": display_name or "未命名專案",
        "created_at": time.time(),
        "media_file": "media" + media_suffix,
        "status": "uploaded",
        "progress": 0.0,
        "error": None,
        "duration": None,
        "language": None,
        "has_video": None,
        "model": config.MODEL_NAME,
        "device": None,
        # 剪輯範圍 {"start": 秒, "end": 秒};None = 整支影片
        "trim": None,
        # 非破壞式剪除的中間區段；來源時間不變，匯出時再拼接保留範圍
        "omit_ranges": [],
    }
    save_project(meta)
    return meta


def clean_trim(raw, duration: float | None) -> dict | None:
    """把外來的剪輯範圍夾成合法區間。太短(<0.5 秒)或涵蓋全片就當作沒設。"""
    if not isinstance(raw, dict):
        return None
    try:
        a = max(float(raw["start"]), 0.0)
        b = float(raw["end"])
    except (KeyError, TypeError, ValueError):
        return None
    if duration:
        a, b = min(a, duration), min(b, duration)
    if b - a < 0.5:
        return None
    if a <= 0 and duration and b >= duration - 0.01:
        return None
    return {"start": round(a, 3), "end": round(b, 3)}


def apply_trim(segments: list[dict], trim: dict | None) -> list[dict]:
    """把字幕裁到剪輯範圍內,並把時間軸平移到以剪輯起點為 0。

    燒錄與匯出字幕檔都要走這裡,不然剪過的成品跟 SRT 會對不起來。
    """
    if not trim:
        return segments
    a, b = trim["start"], trim["end"]
    out = []
    for s in segments:
        if s["end"] <= a or s["start"] >= b:
            continue
        out.append({
            **s,
            "start": round(max(s["start"], a) - a, 3),
            "end": round(min(s["end"], b) - a, 3),
        })
    return out


def apply_edits(segments: list[dict], meta: dict) -> list[dict]:
    """套用頭尾裁切與多段中間剪除，回傳輸出時間軸上的字幕。"""
    return timeline.apply_edits(
        segments,
        float(meta.get("duration") or 0),
        meta.get("trim"),
        meta.get("omit_ranges") or [],
    )


def load_project(pid: str) -> dict | None:
    if not pid or "/" in pid or "\\" in pid or ".." in pid:
        return None
    meta = _load_json(project_dir(pid) / "project.json")
    # 加剪輯功能之前建的專案沒有這個欄位,補上才不用寫 migration
    if meta is not None:
        meta.setdefault("trim", None)
        meta.setdefault("omit_ranges", [])
    return meta


def save_project(meta: dict) -> None:
    _save_json(project_dir(meta["id"]) / "project.json", meta)


def list_projects() -> list[dict]:
    if not config.PROJECTS_DIR.is_dir():
        return []
    projects = []
    for d in config.PROJECTS_DIR.iterdir():
        if d.is_dir():
            meta = load_project(d.name)
            if meta:
                # 加句數之前建的專案沒這個欄位,第一次列出來時補一次就好
                if "seg_count" not in meta:
                    _sync_seg_count(d.name, len(load_subtitles(d.name).get("segments", [])))
                    meta = load_project(d.name) or meta
                projects.append(meta)
    projects.sort(key=lambda m: m.get("created_at", 0), reverse=True)
    return projects


def delete_project(pid: str) -> None:
    d = project_dir(pid)
    if d.is_dir():
        shutil.rmtree(d, ignore_errors=True)


def load_subtitles(pid: str) -> dict:
    data = _load_json(project_dir(pid) / "subtitles.json", {"version": 1, "segments": []})
    data.setdefault("marks", [])
    return data


def save_subtitles(pid: str, data: dict) -> None:
    _save_json(project_dir(pid) / "subtitles.json", data)
    _sync_seg_count(pid, len(data.get("segments", [])))


def _sync_seg_count(pid: str, count: int) -> None:
    """句數記在 project.json 裡,首頁列表才不必去開每一份 subtitles.json。
    只有變了才寫,自動存檔一直打同一個數字不用重寫一次。"""
    meta = load_project(pid)
    if meta is not None and meta.get("seg_count") != count:
        meta["seg_count"] = count
        save_project(meta)


def backup_subtitles(pid: str) -> None:
    """重新辨識覆蓋前,把現有字幕留一份 subtitles.bak.json。"""
    data = load_subtitles(pid)
    if data.get("segments"):
        _save_json(project_dir(pid) / "subtitles.bak.json", data)


def mark_stale_jobs_interrupted() -> None:
    """伺服器啟動時,把上次沒跑完的辨識標記為中斷,讓使用者可以重跑。"""
    for meta in list_projects():
        if meta.get("status") in RUNNING_STATUSES:
            meta["status"] = "interrupted"
            meta["error"] = "辨識中斷(伺服器重啟),請重新辨識"
            save_project(meta)
