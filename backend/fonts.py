"""列出系統已安裝的字型家族名稱,給字幕樣式選單用。

用家族名(不是檔名)才能同時餵給瀏覽器 CSS 與 libass 的 Fontname,
預覽看到的字才會跟燒出來的一樣。列舉一次要幾百毫秒,整個行程只做一次。
"""

import json
import re
import subprocess
import sys

_PS = (
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
    "Add-Type -AssemblyName System.Drawing;"
    "(New-Object System.Drawing.Text.InstalledFontCollection).Families"
    " | ForEach-Object { $_.Name } | ConvertTo-Json -Compress"
)

# 列舉不到時至少給幾個 Windows 一定有的,選單不會開天窗
FALLBACK = ["Microsoft JhengHei", "Microsoft YaHei", "Arial", "Segoe UI"]

_cache: list[str] | None = None


def list_families() -> list[str]:
    global _cache
    if _cache is not None:
        return _cache
    names: list[str] = []
    if sys.platform == "win32":
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command", _PS],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            data = json.loads(out.stdout)
            names = [n for n in data if isinstance(n, str) and n.strip()]
        except (OSError, ValueError, subprocess.SubprocessError):
            names = []
    _cache = sorted(set(names or FALLBACK), key=str.casefold)
    return _cache


# 名稱裡直接帶假名/諺文/漢字的,看字就知道是哪一國(俐方體11號、台北黑體、思源黑體…都吃這條)
_KANA = re.compile(r"[぀-ヿ]")
_HANGUL = re.compile(r"[가-힯ᄀ-ᇿ]")
_HAN = re.compile(r"[㐀-鿿]")

# ponytail: 用名稱判語系,不解析字型檔的 cmap。漏判只是被歸到「其他」,搜尋照樣找得到;
# 真的要精準再去讀 OS/2 的 ulCodePageRange。
_LATIN_NAMED = (
    # (語系, 名稱裡出現就算)
    ("韓文", ("malgun", "gulim", "dotum", "batang", "gungsuh", "nanum", "pretendard",
              "sans kr", "serif kr", "han sans k", "han serif k")),
    ("日文", ("meiryo", "yu gothic", "yu mincho", "ms gothic", "ms mincho", "ms pgothic",
              "ms pmincho", "hiragino", "biz ud", "kosugi", "sawarabi", "m plus",
              "sans jp", "serif jp", "han sans j", "han serif j")),
    ("中文", ("jhenghei", "yahei", "mingliu", "simsun", "nsimsun", "simhei", "kaiti",
              "dfkai", "fangsong", "heiti", "songti", "yuanti", "cubic", "noto sans tc",
              "noto serif tc", "noto sans sc", "noto serif sc", "han sans tw",
              "han sans cn", "han serif tw", "han serif cn", "hanyi", "founder")),
)

GROUP_ORDER = ("中文", "日文", "韓文", "其他")


def _lang_of(name: str) -> str:
    if _HANGUL.search(name):
        return "韓文"
    if _KANA.search(name):
        return "日文"
    low = name.casefold()
    for lang, tokens in _LATIN_NAMED:
        if any(t in low for t in tokens):
            return lang
    return "中文" if _HAN.search(name) else "其他"


def grouped() -> list[dict]:
    """依語系分組,中文排最上面——找中文字型不用在幾百個西文字型裡撈。"""
    buckets: dict[str, list[str]] = {g: [] for g in GROUP_ORDER}
    for name in list_families():
        buckets[_lang_of(name)].append(name)
    return [{"label": g, "fonts": buckets[g]} for g in GROUP_ORDER if buckets[g]]
