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
    "bold": True,
    "italic": False,
    "spacing": 0.0,  # 字距,佔畫面高度 %
    "color": "#FFFFFF",
    # 邊框樣式:outline=描邊、box=整塊底框、none=什麼都不加
    "border": "outline",
    "outline": 0.4,  # 描邊粗細 /(底框模式時)文字到框邊的留白,佔畫面高度 %
    "outline_color": "#000000",
    "outline_opacity": 100,  # %,底框想半透明就調這個
    "shadow": 0.2,  # 陰影位移,佔畫面高度 %
    "shadow_color": "#000000",
    "shadow_opacity": 60,  # %
    "align": "center",  # left / center / right
    "vertical": "bottom",  # top / bottom
    "bottom": 9.0,  # 離上或下邊界,佔畫面高度 %
    "side": 6.0,  # 左右留白,佔畫面寬度 %
    "max_chars": 20,  # 每行最多幾字,超過就自動斷行;0 = 不斷行
    # ---- 譯文(雙語字幕的第二行)。只有這幾項可以跟原文不同,
    # 邊框、陰影、對齊、左右留白都跟著原文走,不然兩行看起來會像兩套字幕。
    "trans_font": "",  # 空字串 = 沿用原文字型
    "trans_size": 0.0,  # 0 = 沿用原文字級
    "trans_color": "#FFE9A8",
    "trans_bold": False,
    "trans_italic": False,
    "trans_gap": 0.8,  # 原文與譯文之間的間距,佔畫面高度 %
}


def trans_of(st: dict) -> dict:
    """把譯文的樣式攤成一份完整設定,沒特別指定的欄位沿用原文。"""
    out = dict(st)
    out["font"] = st["trans_font"] or st["font"]
    out["size"] = st["trans_size"] or st["size"]
    out["color"] = st["trans_color"]
    out["bold"] = st["trans_bold"]
    out["italic"] = st["trans_italic"]
    return out

# 數值上下限:超出範圍的字幕不是看不見就是蓋滿整個畫面
_RANGES = {
    "size": (1.0, 20.0),
    "spacing": (0.0, 2.0),
    "outline": (0.0, 3.0),
    "shadow": (0.0, 3.0),
    "bottom": (0.0, 45.0),
    "side": (0.0, 40.0),
    "outline_opacity": (0, 100),
    "shadow_opacity": (0, 100),
    "max_chars": (0, 60),
    "trans_size": (0.0, 20.0),
    "trans_gap": (0.0, 10.0),
}

_CHOICES = {
    "border": ("outline", "box", "none"),
    "align": ("left", "center", "right"),
    "vertical": ("top", "bottom"),
}


def clean(raw: dict) -> dict:
    """把外來輸入夾回合法範圍。這些值會寫進 ASS 檔再交給 ffmpeg,不能照單全收。"""
    out = dict(DEFAULTS)
    # ASS 的 Style 行用逗號分欄,字型名混進逗號或換行會讓整行解析錯位
    font = re.sub(r"[,\r\n{}]", "", str(raw.get("font") or ""))[:64].strip()
    if font:
        out["font"] = font
    # 譯文字型允許留空(＝沿用原文),所以不像上面那樣「空的就跳過」
    out["trans_font"] = re.sub(r"[,\r\n{}]", "", str(raw.get("trans_font") or ""))[:64].strip()
    for key, (lo, hi) in _RANGES.items():
        try:
            value = min(max(float(raw[key]), lo), hi)
        except (KeyError, TypeError, ValueError):
            continue
        out[key] = int(round(value)) if isinstance(DEFAULTS[key], int) else round(value, 2)
    for key in ("color", "outline_color", "shadow_color", "trans_color"):
        value = str(raw.get(key) or "")
        if re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            out[key] = value.upper()
    for key, allowed in _CHOICES.items():
        if raw.get(key) in allowed:
            out[key] = raw[key]
    for key in ("bold", "italic", "trans_bold", "trans_italic"):
        out[key] = bool(raw.get(key, DEFAULTS[key]))
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
