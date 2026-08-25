"""成品影片匯出:ffmpeg + libass 把字幕燒進影片。

先試 NVENC 硬體編碼 + 音訊直接複製;失敗自動降級
(NVENC+重編音訊 → CPU x264+重編音訊),進度即時回報。
"""

import json
import re
import subprocess
import threading
import traceback

from . import audio, config, exporter, storage, style, timeline

OUT_NAME = "export.mp4"

_jobs: dict[str, dict] = {}
_lock = threading.Lock()

# (影像編碼器, 音訊處理),由快到慢依序嘗試
ATTEMPTS = [
    ("h264_nvenc", "copy"),
    ("h264_nvenc", "aac"),
    ("libx264", "aac"),
]

# 中間剪除走 filter_complex concat,音視訊都得重編碼,不能直接複製音軌
CONCAT_ATTEMPTS = [
    ("h264_nvenc", "aac"),
    ("libx264", "aac"),
]


def get_state(pid: str) -> dict:
    with _lock:
        job = _jobs.get(pid)
        state = (
            {k: job[k] for k in ("status", "progress", "error")}
            if job
            else {"status": "idle", "progress": 0.0, "error": None}
        )
    state["has_file"] = (storage.project_dir(pid) / OUT_NAME).is_file()
    return state


def cancel(pid: str) -> None:
    with _lock:
        job = _jobs.get(pid)
        if job and job["status"] == "running":
            job["cancel"] = True
            proc = job.get("proc")
            if proc is not None:
                try:
                    proc.kill()
                except OSError:
                    pass
        else:
            _jobs.pop(pid, None)


def _probe_media(media) -> tuple[int, int, bool]:
    out = subprocess.run(
        [config.FFPROBE, "-v", "error", "-show_entries", "stream=codec_type,width,height",
         "-of", "json", str(media)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    streams = json.loads(out.stdout).get("streams") or []
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError("讀不到影片解析度")
    has_audio = any(stream.get("codec_type") == "audio" for stream in streams)
    return int(video["width"]), int(video["height"]), has_audio


def start(pid: str) -> dict:
    meta = storage.load_project(pid)
    if meta is None:
        raise RuntimeError("找不到專案")
    if not meta.get("has_video"):
        raise RuntimeError("純音訊檔沒有畫面,無法輸出成品影片")
    d = storage.project_dir(pid)
    media = d / meta["media_file"]
    if not media.is_file():
        raise RuntimeError("找不到媒體檔")
    segments = storage.load_subtitles(pid)["segments"]
    if not segments:
        raise RuntimeError("沒有字幕可以燒錄")
    with _lock:
        existing = _jobs.get(pid)
        if existing and existing["status"] == "running":
            raise RuntimeError("匯出已在進行中")

    width, height, has_audio = _probe_media(media)
    trim = meta.get("trim")
    omit_ranges = meta.get("omit_ranges") or []
    intervals = timeline.kept_intervals(float(meta.get("duration") or 0), trim, omit_ranges)
    segments = storage.apply_edits(segments, meta)
    if not segments:
        raise RuntimeError("保留的剪輯範圍內沒有字幕")
    (d / "burn.ass").write_text(
        exporter.to_ass(segments, width, height, style.load()), encoding="utf-8"
    )

    job = {"status": "running", "progress": 0.0, "error": None, "cancel": False, "proc": None}
    with _lock:
        _jobs[pid] = job
    duration = timeline.edited_duration(float(meta.get("duration") or 0), trim, omit_ranges)
    threading.Thread(
        target=_run,
        args=(
            pid, d, meta["media_file"], duration, trim, intervals,
            has_audio, bool(omit_ranges), job, audio.filter_chain(),
        ),
        daemon=True,
    ).start()
    return get_state(pid)


def _run(
    pid: str,
    d,
    media_name: str,
    duration: float,
    trim: dict | None,
    intervals: list[dict],
    has_audio: bool,
    use_concat: bool,
    job: dict,
    afilter: str = "",
) -> None:
    err_file = d / "burn_err.txt"
    try:
        last_err = ""
        # 中間剪除要 concat 重組時間軸,音視訊都得重編碼;有音訊濾鏡也不能直接複製音軌
        attempts = ATTEMPTS if not use_concat else CONCAT_ATTEMPTS
        attempts = [a for a in attempts if not (afilter and a[1] == "copy")]
        for vcodec, acodec in attempts:
            if job["cancel"]:
                job["status"] = "canceled"
                return
            args = [config.FFMPEG, "-y", "-v", "error", "-nostats", "-progress", "pipe:1"]
            # -ss 放在 -i 前面是「輸入端尋址」,快而且輸出時間軸會歸零,
            # 剛好對上已經平移過的 burn.ass
            if trim and not use_concat:
                args += ["-ss", f"{trim['start']:.3f}", "-t", f"{trim['end'] - trim['start']:.3f}"]
            args += ["-i", media_name]
            if use_concat:
                filters = []
                inputs = []
                for index, interval in enumerate(intervals):
                    start, end = interval["start"], interval["end"]
                    filters.append(
                        f"[0:v]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS[v{index}]"
                    )
                    inputs.append(f"[v{index}]")
                    if has_audio:
                        filters.append(
                            f"[0:a]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{index}]"
                        )
                        inputs.append(f"[a{index}]")
                filters.append(
                    "".join(inputs)
                    + f"concat=n={len(intervals)}:v=1:a={1 if has_audio else 0}[vcat]"
                    + ("[acat]" if has_audio else "")
                )
                filters.append("[vcat]ass=burn.ass[vout]")
                if has_audio and afilter:
                    filters.append(f"[acat]{afilter}[aout]")
                args += ["-filter_complex", ";".join(filters), "-map", "[vout]"]
                if has_audio:
                    args += ["-map", "[aout]" if (has_audio and afilter) else "[acat]"]
            else:
                args += ["-vf", "ass=burn.ass"]
            args += ["-c:v", vcodec]
            if vcodec == "h264_nvenc":
                args += ["-preset", "p5", "-cq", "19"]
            else:
                args += ["-preset", "medium", "-crf", "19"]
            if has_audio:
                if afilter and not use_concat:
                    args += ["-af", afilter]
                args += ["-c:a", acodec]
            if has_audio and acodec == "aac":
                args += ["-b:a", "192k"]
            args += [OUT_NAME]

            # stderr 導到檔案,避免管線塞滿造成死鎖
            with err_file.open("w", encoding="utf-8") as ef:
                proc = subprocess.Popen(
                    args, cwd=str(d), stdout=subprocess.PIPE, stderr=ef,
                    text=True, encoding="utf-8", errors="replace",
                )
                job["proc"] = proc
                assert proc.stdout is not None
                for line in proc.stdout:
                    m = re.match(r"out_time=(\d+):(\d+):([\d.]+)", line.strip())
                    if m and duration > 0:
                        t = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
                        job["progress"] = min(round(t / duration, 3), 0.99)
                proc.wait()
                job["proc"] = None

            if job["cancel"]:
                job["status"] = "canceled"
                return
            if proc.returncode == 0:
                job["progress"] = 1.0
                job["status"] = "done"
                return
            last_err = err_file.read_text(encoding="utf-8", errors="replace").strip()[-300:]
            print(f"[yaozi] {vcodec}+{acodec} 匯出失敗,換下一個組合:{last_err}")
        raise RuntimeError(f"ffmpeg 匯出失敗:{last_err}")
    except Exception as e:
        traceback.print_exc()
        if job.get("status") != "canceled":
            job["status"] = "error"
            job["error"] = str(e)[:400]
    finally:
        job["proc"] = None
        err_file.unlink(missing_ok=True)
