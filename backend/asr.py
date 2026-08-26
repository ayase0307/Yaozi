"""辨識設定:語言、提示詞、VAD 靈敏度。

跟字幕外觀一樣是全域設定(存 projects/_asr.json),重新辨識時讀當下這一份。
預設語言是「自動偵測」——鎖成單一語言的話,只要丟進來的影片不是那個語言,
Whisper 會硬把聽到的東西翻成鎖定語言,結果就是整段幻覺。
"""

import json
import os
import re
import threading

from . import config

_lock = threading.Lock()

DEFAULTS = {
    "language": config.LANGUAGE,  # "auto" = 自動偵測,其他是 Whisper 語言代碼
    "prompt": "",  # 提示詞:人名、專有名詞、歌詞片段,幫模型聽對難字
    "vad": False,  # 預設保留完整音軌；需要時再開啟無語音片段過濾
    "vad_threshold": 0.5,  # 越低抓到越多語音(小聲、唱歌),越高越不會把雜訊當人聲
    "split_chars": 24,  # 一句最多幾個中文字(英文字母算半個);碎片會黏回來、超長的切開,0 = 都不動
}

# 只做長度與格式的把關,語言代碼不寫死清單(Whisper 支援 99 種,前端只列常用的)
_CODE = re.compile(r"^[a-z]{2,3}$")


def clean(raw: dict) -> dict:
    out = dict(DEFAULTS)
    lang = str(raw.get("language") or "").strip().lower()
    if lang == "auto" or _CODE.fullmatch(lang):
        out["language"] = lang
    out["prompt"] = str(raw.get("prompt") or "").strip()[:800]
    out["vad"] = bool(raw.get("vad", DEFAULTS["vad"]))
    try:
        out["vad_threshold"] = round(min(max(float(raw["vad_threshold"]), 0.1), 0.9), 2)
    except (KeyError, TypeError, ValueError):
        pass
    try:
        out["split_chars"] = int(min(max(float(raw["split_chars"]), 0), 80))
    except (KeyError, TypeError, ValueError):
        pass
    return out


def _file():
    return config.PROJECTS_DIR / "_asr.json"


def load() -> dict:
    try:
        with _file().open("r", encoding="utf-8") as f:
            return clean(json.load(f))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULTS)


def save(raw: dict) -> dict:
    data = clean(raw)
    with _lock:
        path = _file()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    return data
