"""字幕翻譯。走使用者已安裝的 Claude Code CLI(訂閱制,不用另外辦 API key)。

翻完直接寫回字幕的 trans 欄位,不像 AI 校正那樣要逐條審——譯文本來就會想自己改,
在編輯器裡改比在 diff 面板裡按同意快。
"""

import json
import os
import subprocess
import threading
import time
import traceback

from . import dictionary, llm, storage

BATCH_CHARS = 3000
BATCH_LINES = 60
TIMEOUT = 420

LANGUAGES = ["英文", "日文", "韓文", "繁體中文", "簡體中文", "越南文", "印尼文", "泰文", "西班牙文"]

SCHEMA = json.dumps(
    {
        "type": "object",
        "properties": {
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"i": {"type": "integer"}, "t": {"type": "string"}},
                    "required": ["i", "t"],
                },
            }
        },
        "required": ["lines"],
    },
    separators=(",", ":"),
)

# ponytail: VideoLingo 是「翻譯→反思→在地化」跑三次呼叫,這裡壓成一次呼叫、三個步驟
# 在同一段提示詞裡做完,省 2/3 的時間與額度。品質真的不夠再拆成三次。
PROMPT = """你是專業的影視字幕翻譯。最後面附上一段字幕 JSON 陣列,每項有行號 i 與原文 t。
請把每一行翻成{target},並在心裡照這三步做完再輸出:
1. 直譯:先確保意思沒有漏、沒有加。
2. 反思:檢查有沒有翻譯腔、有沒有誤解上下文、專有名詞對不對。
3. 在地化:改寫成{target}母語者會講的自然說法。

規則:
- 一行對一行,不可合併或拆分,行數與行號都要跟原文一致
- 這是字幕,每行要短、口語、可以一眼讀完,不要書面化的長句
- 語氣詞與情緒要保留,不要翻成正式書面語
- 專有名詞、人名、品牌維持通用譯法;沒有通用譯法就保留原文
- 只輸出譯文本身,不要加引號、不要加註解
用 lines 回傳:i 是原行號,t 是譯文。"""


_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _file(pid: str):
    return storage.project_dir(pid) / "translate.json"


def _public(job: dict | None) -> dict:
    if job is None:
        return {"status": "idle"}
    return {k: job[k] for k in ("status", "total", "done", "target", "error", "started_at")}


def get_state(pid: str) -> dict:
    with _lock:
        job = _jobs.get(pid)
    if job is not None:
        return _public(job)
    try:
        with _file(pid).open("r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"status": "idle"}


def cancel(pid: str) -> None:
    with _lock:
        job = _jobs.get(pid)
        if job and job["status"] == "running":
            job["cancel"] = True
        else:
            _jobs.pop(pid, None)
    _file(pid).unlink(missing_ok=True)


def clear(pid: str) -> dict:
    """把所有譯文拿掉,回到單語字幕。"""
    cancel(pid)
    data = storage.load_subtitles(pid)
    for s in data["segments"]:
        s.pop("trans", None)
    storage.save_subtitles(pid, data)
    return {"status": "idle"}


def start(pid: str, target: str) -> dict:
    cmd = llm.find_claude()
    if cmd is None:
        raise RuntimeError("找不到 claude 指令,請先安裝 Claude Code")
    if target not in LANGUAGES:
        raise RuntimeError(f"不支援的語言:{target}")
    segments = storage.load_subtitles(pid)["segments"]
    if not segments:
        raise RuntimeError("這個專案還沒有字幕")

    batches: list[list[int]] = []
    cur: list[int] = []
    chars = 0
    for i, s in enumerate(segments):
        cur.append(i)
        chars += len(s["text"])
        if len(cur) >= BATCH_LINES or chars >= BATCH_CHARS:
            batches.append(cur)
            cur, chars = [], 0
    if cur:
        batches.append(cur)

    job = {
        "status": "running",
        "total": len(batches),
        "done": 0,
        "target": target,
        "error": None,
        "started_at": time.time(),
        "cancel": False,
    }
    with _lock:
        existing = _jobs.get(pid)
        if existing and existing["status"] == "running":
            raise RuntimeError("翻譯已在進行中")
        _jobs[pid] = job

    threading.Thread(target=_run, args=(pid, cmd, batches, job), daemon=True).start()
    return _public(job)


def _run_batch(cmd: list[str], segments: list[dict], indices: list[int], target: str) -> dict:
    payload = json.dumps(
        [{"i": i, "t": segments[i]["text"]} for i in indices], ensure_ascii=False
    )
    prompt = PROMPT.format(target=target) + _terms(target)
    proc = subprocess.run(
        cmd + ["-p", "--output-format", "json", "--json-schema", SCHEMA, "--model", llm.MODEL],
        input=f"{prompt}\n\n字幕內容:\n{payload}",
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=TIMEOUT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude 執行失敗:{(proc.stderr or proc.stdout).strip()[-300:]}")
    data = json.loads(proc.stdout)
    if data.get("is_error") or data.get("subtype") != "success":
        raise RuntimeError(f"claude 回傳錯誤:{str(data.get('result'))[:300]}")
    out = llm.structured(data, "翻譯")

    valid = set(indices)
    return {
        c["i"]: c["t"].strip()
        for c in (out.get("lines") or [])
        if c.get("i") in valid and (c.get("t") or "").strip()
    }


def _terms(target: str) -> str:
    entries = dictionary.load()[:200]
    if not entries:
        return ""
    names = "、".join(e["right"] for e in entries)
    return f"\n\n這支影片會出現的專有名詞(先確認它們在{target}的正確譯法):\n{names}"


def _run(pid: str, cmd: list[str], batches: list[list[int]], job: dict) -> None:
    try:
        for indices in batches:
            if job["cancel"]:
                job["status"] = "canceled"
                return
            # 每批都重讀:使用者可能一邊翻一邊改字幕,以最新內容為準
            data = storage.load_subtitles(pid)
            segments = data["segments"]
            got = _run_batch(cmd, segments, indices, job["target"])
            for i, text in got.items():
                if i < len(segments):
                    segments[i]["trans"] = text
            storage.save_subtitles(pid, data)
            with _lock:
                job["done"] += 1
        job["status"] = "done"
    except Exception as e:
        traceback.print_exc()
        job["status"] = "error"
        job["error"] = str(e)[:500]
    finally:
        try:
            f = _file(pid)
            tmp = f.with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as fp:
                json.dump(_public(job), fp, ensure_ascii=False)
            os.replace(tmp, f)
        except OSError:
            traceback.print_exc()
