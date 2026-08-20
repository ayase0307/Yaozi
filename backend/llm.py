"""用使用者已安裝的 Claude Code / Codex CLI 做字幕錯字校正。

設計原則(見 SPEC 3.5):
- 指令自動尋路,找不到就整個功能隱藏,不影響其他功能
- 只送「行號+文字」,LLM 碰不到時間軸;回傳用 --json-schema 強制結構
- 大批次呼叫(每次呼叫有 ~30k token 的固定開銷)
- 建議不自動套用,由前端 diff 審閱
"""

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import traceback
from pathlib import Path

from . import config, dictionary, storage

MODEL = os.environ.get("YAOZI_FIX_MODEL", "sonnet")
PROVIDERS = ("claude", "codex")
PROVIDER_LABELS = {"claude": "Claude Code", "codex": "Codex CLI"}
BATCH_CHARS = 4000  # 每批的字元預算
BATCH_LINES = 80
TIMEOUT = 300

SCHEMA = json.dumps(
    {
        "type": "object",
        "properties": {
            "changes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "i": {"type": "integer"},
                        "t": {"type": "string"},
                    },
                    "required": ["i", "t"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["changes"],
        "additionalProperties": False,
    },
    separators=(",", ":"),
)

PROMPT = """你是台灣的專業字幕校對員。最後面附上一段影片的字幕 JSON 陣列(繁體中文、台灣口語),每項有行號 i 與文字 t。
請找出並修正:
1. 語音辨識造成的同音錯字與選字錯誤(例:其美博物館→奇美博物館、發老→法老、在→再)
2. 中國用語改成台灣慣用語(例:視頻→影片、質量→品質、軟件→軟體)
3. 品牌與專有名詞的正確寫法與大小寫(例:youtube→YouTube、Ig→IG)
規則:
- 只回傳有修正的行,沒錯的行不要回傳
- 不可增刪或合併句子,不可改變句意
- 口語詞與語氣詞(嗯、啊、欸、就是、其實…)一律保留,不要書面化
- 字數盡量與原文相近,禁止重寫句子
- 標點維持原樣,不要新增句尾標點
用 changes 回傳:i 是原行號,t 是修正後的整行文字。整批都沒錯就回傳空的 changes。"""


def _terms_block() -> str:
    """把詞庫塞進提示詞。

    詞庫本身只做字面取代,碰不到「同音但寫法不同」的漏網之魚;但它等於是使用者
    親手列的專有名詞表,讓 LLM 知道這支影片會出現哪些詞,同音錯字的命中率差很多。
    """
    entries = dictionary.load()[:200]
    if not entries:
        return ""
    pairs = "、".join(f"{e['wrong']}→{e['right']}" for e in entries)
    return (
        "\n\n這支影片的專有名詞對照(使用者自訂的詞庫,右邊才是正確寫法,"
        f"看到左邊或其他同音寫法都要改成右邊):\n{pairs}"
    )

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _settings_file() -> Path:
    return config.PROJECTS_DIR / "_ai.json"


def load_settings() -> dict:
    """讀取全域 AI 引擎設定；舊版專案預設仍使用 Claude。"""
    try:
        with _settings_file().open("r", encoding="utf-8") as fp:
            provider = json.load(fp).get("provider")
    except (OSError, json.JSONDecodeError, AttributeError):
        provider = None
    return {"provider": provider if provider in PROVIDERS else "claude"}


def save_settings(raw: dict) -> dict:
    provider = raw.get("provider")
    if provider not in PROVIDERS:
        raise ValueError("AI 引擎必須是 claude 或 codex")
    if find_provider(provider) is None:
        raise ValueError(f"找不到 {PROVIDER_LABELS[provider]} 指令，請先安裝並登入")
    config.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    path = _settings_file()
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fp:
        json.dump({"provider": provider}, fp, ensure_ascii=False)
    os.replace(tmp, path)
    return {"provider": provider}


def find_claude() -> list[str] | None:
    path = shutil.which("claude")
    if not path:
        candidates = [
            Path.home() / ".local" / "bin" / "claude.exe",
            Path(os.environ.get("APPDATA", "")) / "npm" / "claude.cmd",
        ]
        for c in candidates:
            if c.is_file():
                path = str(c)
                break
    if not path:
        return None
    # .cmd/.bat 無法被 CreateProcess 直接執行,要透過 cmd /c
    if path.lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", path]
    return [path]


def find_codex() -> list[str] | None:
    path = shutil.which("codex")
    if not path:
        candidates = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WindowsApps" / "codex.exe",
            Path(os.environ.get("APPDATA", "")) / "npm" / "codex.cmd",
            Path.home() / ".local" / "bin" / "codex",
        ]
        for c in candidates:
            if c.is_file():
                path = str(c)
                break
    if not path:
        return None
    if path.lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", path]
    return [path]


def find_provider(provider: str) -> list[str] | None:
    if provider == "claude":
        return find_claude()
    if provider == "codex":
        return find_codex()
    return None


def provider_status() -> dict:
    selected = load_settings()["provider"]
    providers = {
        provider: {
            "label": PROVIDER_LABELS[provider],
            "available": find_provider(provider) is not None,
        }
        for provider in PROVIDERS
    }
    return {
        "provider": selected,
        "available": providers[selected]["available"],
        "providers": providers,
    }


def structured(data: dict, what: str) -> dict:
    """從 claude CLI 的 JSON 回應裡挖出 structured_output。

    模型有可能不照 schema 回,而是回一段普通文字(最常見的是它拒絕做這件事,
    例如判定內容是受版權保護的歌詞)。這時候直接 json.loads 只會得到
    「Expecting value: line 1 column 1」,使用者根本看不出發生什麼事——
    所以把模型講的話原封不動當成錯誤訊息丟出去。
    """
    out = data.get("structured_output")
    if isinstance(out, dict):
        return out
    text = str(data.get("result", "")).strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError(f"Claude 沒有回傳{what}結果,它說:{text[:400] or '(空白回應)'}") from None
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Claude 的{what}結果格式不對:{text[:200]}")
    return parsed


def run_structured(
    provider: str,
    cmd: list[str],
    prompt: str,
    schema: str,
    what: str,
    timeout: int,
) -> dict:
    """用選定的 CLI 執行提示詞，回傳已通過 JSON Schema 的物件。"""
    if provider == "claude":
        proc = subprocess.run(
            cmd
            + [
                "-p",
                "--output-format", "json",
                "--json-schema", schema,
                "--model", MODEL,
            ],
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"Claude Code 執行失敗:{(proc.stderr or proc.stdout).strip()[-300:]}")
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise RuntimeError(f"Claude Code 回應格式錯誤:{proc.stdout.strip()[-300:]}") from None
        if data.get("is_error") or data.get("subtype") != "success":
            raise RuntimeError(f"Claude Code 回傳錯誤:{str(data.get('result'))[:300]}")
        return structured(data, what)

    if provider != "codex":
        raise RuntimeError(f"不支援的 AI 引擎:{provider}")
    with tempfile.TemporaryDirectory(prefix="yaozi-codex-") as tmp_dir:
        work = Path(tmp_dir)
        schema_path = work / "schema.json"
        result_path = work / "result.json"
        schema_path.write_text(schema, encoding="utf-8")
        proc = subprocess.run(
            cmd
            + [
                "exec",
                "--ephemeral",
                "--sandbox", "read-only",
                "--skip-git-repo-check",
                "--color", "never",
                "--output-schema", str(schema_path),
                "--output-last-message", str(result_path),
                "-",
            ],
            input=prompt,
            cwd=work,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        if proc.returncode != 0:
            message = (proc.stderr or proc.stdout).strip()[-500:]
            raise RuntimeError(f"Codex CLI 執行失敗:{message or '(沒有錯誤訊息)'}")
        try:
            parsed = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            message = (proc.stderr or proc.stdout).strip()[-300:]
            raise RuntimeError(f"Codex CLI 沒有回傳{what}結果:{message or '(空白回應)'}") from None
        if not isinstance(parsed, dict):
            raise RuntimeError(f"Codex CLI 的{what}結果格式不對")
        return parsed


def _public_state(job: dict | None) -> dict:
    if job is None:
        return {"status": "idle"}
    state = {
        k: job[k]
        for k in ("status", "total", "done", "suggestions", "error", "started_at", "provider")
    }
    state["progress"] = 1.0 if job["status"] == "done" else job["done"] / max(job["total"], 1)
    return state


def _fix_file(pid: str):
    return storage.project_dir(pid) / "fix.json"


def _save_fix_file(pid: str, job: dict) -> None:
    """校正結果落地,伺服器重開也還原得回來。"""
    f = _fix_file(pid)
    tmp = f.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fp:
        json.dump(
            {
                "total": job.get("total", 1),
                "started_at": job.get("started_at"),
                "suggestions": job.get("suggestions", []),
                "provider": job.get("provider", load_settings()["provider"]),
            },
            fp,
            ensure_ascii=False,
        )
    os.replace(tmp, f)


def get_state(pid: str) -> dict:
    with _lock:
        job = _jobs.get(pid)
        if job is not None:
            return _public_state(job)
    f = _fix_file(pid)
    if f.is_file():
        try:
            with f.open("r", encoding="utf-8") as fp:
                data = json.load(fp)
            return {
                "status": "done",
                "total": data.get("total", 1),
                "done": data.get("total", 1),
                "suggestions": data.get("suggestions", []),
                "error": None,
                "started_at": data.get("started_at"),
                "provider": data.get("provider", load_settings()["provider"]),
                "progress": 1.0,
            }
        except (OSError, json.JSONDecodeError):
            pass
    return {"status": "idle"}


def cancel(pid: str) -> None:
    with _lock:
        job = _jobs.get(pid)
        if job and job["status"] == "running":
            job["cancel"] = True
        else:
            _jobs.pop(pid, None)
    _fix_file(pid).unlink(missing_ok=True)


def update_suggestions(pid: str, suggestions: list[dict]) -> None:
    """審閱時同步剩餘清單(接受/略過一條就少一條),關機重開能從剩的繼續。"""
    with _lock:
        job = _jobs.get(pid)
        if job and job["status"] == "done":
            job["suggestions"] = suggestions
        holder = dict(job) if job else {"total": 1, "started_at": None, "suggestions": suggestions}
    holder["suggestions"] = suggestions
    if suggestions:
        _save_fix_file(pid, holder)
    else:
        _fix_file(pid).unlink(missing_ok=True)


def start(pid: str) -> dict:
    provider = load_settings()["provider"]
    cmd = find_provider(provider)
    if cmd is None:
        raise RuntimeError(f"找不到 {PROVIDER_LABELS[provider]} 指令，請到設定切換或先完成安裝")
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
        "suggestions": [],
        "error": None,
        "started_at": time.time(),
        "cancel": False,
        "provider": provider,
    }
    with _lock:
        existing = _jobs.get(pid)
        if existing and existing["status"] == "running":
            raise RuntimeError("AI 校正已在進行中")
        _jobs[pid] = job

    threading.Thread(target=_run, args=(pid, provider, cmd, segments, batches, job), daemon=True).start()
    return _public_state(job)


def _run_batch(provider: str, cmd: list[str], segments: list[dict], indices: list[int]) -> list[dict]:
    payload = json.dumps(
        [{"i": i, "t": segments[i]["text"]} for i in indices], ensure_ascii=False
    )
    # 多行的提示詞不放命令列(npm 版 claude.cmd 經 cmd /c 轉手會壞),
    # 全部改走 stdin;命令列只留單行參數。
    out = run_structured(
        provider,
        cmd,
        f"{PROMPT}{_terms_block()}\n\n字幕內容:\n{payload}",
        SCHEMA,
        "校正",
        TIMEOUT,
    )
    changes = out.get("changes") or []

    valid = set(indices)
    suggestions = []
    for c in changes:
        i = c.get("i")
        new = (c.get("t") or "").strip()
        if i in valid and new and new != segments[i]["text"]:
            suggestions.append({"id": segments[i]["id"], "old": segments[i]["text"], "new": new})
    return suggestions


def _run(
    pid: str,
    provider: str,
    cmd: list[str],
    segments: list[dict],
    batches: list[list[int]],
    job: dict,
) -> None:
    try:
        for indices in batches:
            if job["cancel"]:
                job["status"] = "canceled"
                return
            suggestions = _run_batch(provider, cmd, segments, indices)
            with _lock:
                job["suggestions"].extend(suggestions)
                job["done"] += 1
        job["status"] = "done"
        try:
            _save_fix_file(pid, job)
        except OSError:
            traceback.print_exc()  # 存檔失敗不影響本次結果,只是重開伺服器會遺失
    except Exception as e:
        traceback.print_exc()
        job["status"] = "error"
        job["error"] = str(e)[:500]
