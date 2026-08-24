"""音訊處理設定:去噪、人聲頻段、響度標準化、音量增益。

跟辨識設定/字幕外觀一樣是全域設定(存 projects/_audio.json),
產生的是一條 ffmpeg -af 濾鏡鏈,兩個地方共用:
  * 匯出成品影片(burn.py)
  * 辨識前抽音軌(transcriber.py,只在 pre_asr 打開時)

濾鏡順序是固定的,調換會出事:先去噪 → 再切頻段 → 再標準化響度 → 最後補增益。
反過來做的話,增益會把還沒壓掉的噪音一起放大。
"""

import json
import os
import threading

from . import config

_lock = threading.Lock()

DEFAULTS = {
    "denoise": False,  # afftdn:FFT 降噪,吃掉冷氣、風扇那種持續底噪
    "denoise_db": 12,  # 降噪強度(dB),越大越乾淨也越容易讓人聲發悶
    "voice": False,  # 只留人聲頻段(80Hz~8kHz),砍掉低頻隆隆聲與嘶聲
    "normalize": False,  # loudnorm:整支拉到同一個響度(EBU R128)
    "target_lufs": -16,  # 標準化目標響度;-16 是串流平台常見值,-14 更響
    "gain_db": 0,  # 最後補的固定增益,單純想「大聲一點」用這個
    "pre_asr": False,  # 辨識前也套一次(收音很糟的素材才需要,乾淨的反而會變差)
}


def clean(raw: dict) -> dict:
    out = dict(DEFAULTS)
    for key in ("denoise", "voice", "normalize", "pre_asr"):
        out[key] = bool(raw.get(key, DEFAULTS[key]))
    for key, lo, hi in (("denoise_db", 1, 60), ("target_lufs", -30, -8), ("gain_db", -20, 20)):
        try:
            out[key] = int(min(max(float(raw[key]), lo), hi))
        except (KeyError, TypeError, ValueError):
            pass
    return out


def filter_chain(cfg: dict | None = None) -> str:
    """回傳 ffmpeg -af 用的濾鏡字串,全關就是空字串(呼叫端別加 -af)。"""
    cfg = clean(cfg or load())
    parts = []
    if cfg["denoise"]:
        parts.append(f"afftdn=nr={cfg['denoise_db']}:nf=-25")
    if cfg["voice"]:
        parts += ["highpass=f=80", "lowpass=f=8000"]
    if cfg["normalize"]:
        # 單軌 loudnorm 是動態壓的,不需要兩趟分析;夠用了
        # ponytail: 要更精準的響度就改成雙趟(先量測再套用),慢一倍
        parts.append(f"loudnorm=I={cfg['target_lufs']}:TP=-1.5:LRA=11")
    if cfg["gain_db"]:
        parts.append(f"volume={cfg['gain_db']}dB")
    return ",".join(parts)


def _file():
    return config.PROJECTS_DIR / "_audio.json"


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
