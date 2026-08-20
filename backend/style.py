"""字幕外觀設定:燒錄用的 ASS 樣式,前端預覽也套同一組值。

全域共用(跟詞庫一樣存在 projects/_style.json),單人使用不需要每個專案各設一份。
尺寸類的值一律存「佔畫面高度的百分比」,換解析度不用重設。
"""

import json
import os
import re
import threading

from . import config

_lock = threading.Lock()

DEFAULTS = {
    "font": "Microsoft JhengHei",
    "size": 5.5,  # 字級,佔畫面高度 %
    "color": "#FFFFFF",
    "outline_color": "#000000",
    "outline": 0.4,  # 外框粗細,佔畫面高度 %
    "bottom": 9.0,  # 字幕底部離畫面底邊,佔畫面高度 %
    "bold": True,
}

# 數值上下限:超出範圍的字幕不是看不見就是蓋滿整個畫面
_RANGES = {"size": (1.0, 20.0), "outline": (0.0, 3.0), "bottom": (0.0, 45.0)}


def clean(raw: dict) -> dict:
    """把外來輸入夾回合法範圍。這些值會寫進 ASS 檔再交給 ffmpeg,不能照單全收。"""
    out = dict(DEFAULTS)
    # ASS 的 Style 行用逗號分欄,字型名混進逗號或換行會讓整行解析錯位
    font = re.sub(r"[,\r\n{}]", "", str(raw.get("font") or ""))[:64].strip()
    if font:
        out["font"] = font
    for key, (lo, hi) in _RANGES.items():
        try:
            out[key] = round(min(max(float(raw[key]), lo), hi), 2)
        except (KeyError, TypeError, ValueError):
            pass
    for key in ("color", "outline_color"):
        value = str(raw.get(key) or "")
        if re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            out[key] = value.upper()
    out["bold"] = bool(raw.get("bold", DEFAULTS["bold"]))
    return out


def _file():
    return config.PROJECTS_DIR / "_style.json"


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
