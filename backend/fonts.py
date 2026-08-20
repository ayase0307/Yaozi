"""列出系統已安裝的字型家族名稱,給字幕樣式選單用。

用家族名(不是檔名)才能同時餵給瀏覽器 CSS 與 libass 的 Fontname,
預覽看到的字才會跟燒出來的一樣。列舉一次要幾百毫秒,整個行程只做一次。
"""

import json
import mmap
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

# GetName(1033) 是同一個家族的英文名(name table 的 nameID 1 / 0x409)。
# GDI 預設回報本地化名稱(「源泉圓體丹 B」),Chrome 有一大半認不出來,選了就默默
# 掉回系統字——看起來就是「選了沒反應」。兩個名字都送出去,前端排成 font stack。
_PS = (
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
    "Add-Type -AssemblyName System.Drawing;"
    "(New-Object System.Drawing.Text.InstalledFontCollection).Families"
    " | ForEach-Object { @{ n = $_.Name; e = $_.GetName(1033) } }"
    " | ConvertTo-Json -Compress"
)

# 列舉不到時至少給幾個 Windows 一定有的,選單不會開天窗
FALLBACK = ["Microsoft JhengHei", "Microsoft YaHei", "Arial", "Segoe UI"]

# [(本地化家族名, 英文家族名)];兩者相同時 en 就是同一個字串
_cache: list[tuple[str, str]] | None = None


def list_families() -> list[tuple[str, str]]:
    global _cache
    if _cache is not None:
        return _cache
    pairs: list[tuple[str, str]] = []
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
            # 只裝一個字型時 ConvertTo-Json 吐的是單一物件而不是陣列
            if isinstance(data, dict):
                data = [data]
            for item in data:
                if not isinstance(item, dict):
                    continue
                name, en = item.get("n"), item.get("e")
                if not isinstance(name, str) or not name.strip():
                    continue
                pairs.append((name, en if isinstance(en, str) and en.strip() else name))
        except (OSError, ValueError, subprocess.SubprocessError):
            pairs = []
    # InstalledFontCollection 會漏掉「檔案已放進使用者 Fonts 目錄、但 HKCU 沒登記」
    # 的字型。這台電腦的華康、源泉圓體等正是這種狀態，所以還要直接讀字型檔。
    if sys.platform == "win32":
        _ensure_files()
        pairs.extend(_file_pairs)
    if not pairs:
        pairs = [(n, n) for n in FALLBACK]
    # 同一家族可能同時由 GDI 與檔案掃描找到；保留先出現的 GDI 顯示名稱。
    unique: dict[str, tuple[str, str]] = {}
    for name, en in pairs:
        unique.setdefault(name.casefold(), (name, en))
    _cache = sorted(unique.values(), key=lambda p: p[0].casefold())
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


# 註冊表值名長這樣:「源泉圓體丹 B & 源泉圓體月 B & GenSenRounded2 JP B & … (TrueType)」,
# 值是字型檔路徑(機器層級的常只寫檔名,要接回 C:\Windows\Fonts)。
FONT_DIRS = [
    Path(os.environ.get("SystemRoot", r"C:\Windows")) / "Fonts",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "Windows" / "Fonts",
]
_REG_PATH = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
_FONT_EXTS = {".ttf", ".otf", ".ttc", ".otc"}

# Windows language IDs。優先顯示台灣／繁中名稱，英文名另給 CSS、libass 比對。
_ZH_LANGS = (0x0404, 0x0C04, 0x1404, 0x1004, 0x7C04)
_EN_LANGS = (0x0409,)

_files: dict[str, Path] | None = None
_file_pairs: list[tuple[str, str]] = []


def _decode_name(raw: bytes, platform: int) -> str:
    """解碼 OpenType name record；壞掉的單筆紀錄直接略過。"""
    try:
        value = raw.decode("utf-16-be" if platform in (0, 3) else "mac_roman")
    except (LookupError, UnicodeDecodeError):
        return ""
    return value.replace("\x00", "").strip()


def _pick_name(records: list[tuple[int, int, str]], languages: tuple[int, ...]) -> str:
    for lang in languages:
        for platform, record_lang, value in records:
            if platform == 3 and record_lang == lang and value:
                return value
    for platform, _lang, value in records:
        if platform in (0, 3) and value:
            return value
    return next((value for _platform, _lang, value in records if value), "")


def _font_metadata(path: Path) -> list[tuple[str, str, set[str]]]:
    """讀一個 SFNT/TTC 的家族名稱，不載入整份大型 CJK 字型到記憶體。

    回傳 (顯示名稱, 英文名稱, 所有可拿來查檔案的別名)。只解析 name table，
    TrueType、OpenType 與 collection 都使用同一個 SFNT 結構。
    """
    faces: list[tuple[str, str, set[str]]] = []
    try:
        with path.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as data:
            if len(data) < 12:
                return []
            if data[:4] == b"ttcf":
                count = struct.unpack_from(">I", data, 8)[0]
                if count > 256 or 12 + count * 4 > len(data):
                    return []
                offsets = struct.unpack_from(f">{count}I", data, 12)
            else:
                offsets = (0,)

            for face_offset in offsets:
                if face_offset + 12 > len(data):
                    continue
                table_count = struct.unpack_from(">H", data, face_offset + 4)[0]
                if table_count > 512 or face_offset + 12 + table_count * 16 > len(data):
                    continue
                name_offset = None
                name_length = 0
                for i in range(table_count):
                    record = face_offset + 12 + i * 16
                    if data[record : record + 4] == b"name":
                        name_offset, name_length = struct.unpack_from(">II", data, record + 8)
                        break
                if name_offset is None or name_offset + min(name_length, 6) > len(data):
                    continue

                record_count, strings_at = struct.unpack_from(">HH", data, name_offset + 2)
                records_at = name_offset + 6
                if record_count > 4096 or records_at + record_count * 12 > len(data):
                    continue
                strings_at += name_offset
                by_id: dict[int, list[tuple[int, int, str]]] = {}
                for i in range(record_count):
                    rec = records_at + i * 12
                    platform, _encoding, lang, name_id, size, offset = struct.unpack_from(
                        ">6H", data, rec
                    )
                    start, end = strings_at + offset, strings_at + offset + size
                    if start < 0 or end > len(data):
                        continue
                    value = _decode_name(data[start:end], platform)
                    if value:
                        by_id.setdefault(name_id, []).append((platform, lang, value))

                # Windows／libass 的選單名稱以 1 (legacy family) 為準；不少中文字型
                # 會把 W3/W5 等字重放在 name ID 1，若優先用 16 會把多個字重併成一項。
                family_records = by_id.get(1) or by_id.get(16) or []
                if not family_records:
                    continue
                english = _pick_name(family_records, _EN_LANGS)
                display = _pick_name(family_records, _ZH_LANGS) or english
                aliases = {
                    value
                    for name_id in (1, 4, 6, 16, 21)
                    for _platform, _lang, value in by_id.get(name_id, [])
                    if value
                }
                if display:
                    aliases.update((display, english))
                    faces.append((display, english or display, aliases))
    except (OSError, OverflowError, struct.error, ValueError):
        return []
    return faces


def _scan_font_dirs() -> tuple[dict[str, Path], list[tuple[str, str]]]:
    """直接掃 Windows 字型目錄，補上沒有 Registry 紀錄的使用者字型。"""
    aliases: dict[str, Path] = {}
    pairs: dict[str, tuple[str, str]] = {}
    for directory in FONT_DIRS:
        try:
            paths = sorted(
                (p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in _FONT_EXTS),
                key=lambda p: p.name.casefold(),
            )
        except OSError:
            continue
        for path in paths:
            for display, english, names in _font_metadata(path):
                pairs.setdefault(display.casefold(), (display, english))
                for name in names:
                    aliases.setdefault(name.casefold(), path)
    return aliases, list(pairs.values())


def _scan_registry() -> dict[str, Path]:
    """家族名(小寫)→ 字型檔路徑。HKCU 蓋過 HKLM,使用者自己裝的優先。"""
    import winreg

    out: dict[str, Path] = {}
    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            key = winreg.OpenKey(root, _REG_PATH)
        except OSError:
            continue
        with key:
            i = 0
            while True:
                try:
                    label, value, _ = winreg.EnumValue(key, i)
                except OSError:
                    break
                i += 1
                if not isinstance(value, str) or not value.strip():
                    continue
                # 值有時是完整路徑、有時只有檔名(HKLM 的擺在 C:\Windows\Fonts,
                # HKCU 的擺在 %LOCALAPPDATA% 底下),兩個目錄都找找看
                cands = [Path(value)] if Path(value).is_absolute() else [d / value for d in FONT_DIRS]
                path = next((c for c in cands if c.is_file()), None)
                if path is None:
                    continue
                # 去掉結尾的「 (TrueType)」,剩下的用 & 拆成一個個家族名
                base = label.rsplit(" (", 1)[0]
                for part in base.split(" & "):
                    part = part.strip()
                    if part:
                        out[part.casefold()] = path
    return out


def _ensure_files() -> None:
    """建立名稱→檔案索引；Registry 優先，檔案內的所有別名補齊缺口。"""
    global _files, _file_pairs
    if _files is not None:
        return
    try:
        indexed = _scan_registry() if sys.platform == "win32" else {}
    except OSError:
        indexed = {}
    aliases, pairs = _scan_font_dirs() if sys.platform == "win32" else ({}, [])
    for name, path in aliases.items():
        indexed.setdefault(name, path)
    _files = indexed
    _file_pairs = pairs


def file_for(family: str) -> Path | None:
    """家族名 → 字型檔。找不到就 None(呼叫端自己決定要不要退回系統字)。

    Windows 的字型比對有三層名字(GDI 家族名、排版家族名、PostScript 名),瀏覽器、
    libass、註冊表各認一種,對不起來就是「選了沒反應」。直接把檔案送給瀏覽器,
    這層不確定性就消失了。
    """
    if sys.platform != "win32":
        return None
    _ensure_files()
    assert _files is not None
    # 名稱可能來自 GDI、OpenType 的本地化／英文家族名或 Registry 顯示文字。
    en = dict(list_families()).get(family.strip())
    for candidate in (family, en):
        if not candidate:
            continue
        key = candidate.strip().casefold()
        hit = _files.get(key)
        if hit is not None:
            return hit
        # 註冊表有時寫成「華康圓體 Std W3 Regular」,選單上只有「華康圓體 Std W3」
        for name, path in _files.items():
            if name.startswith(key + " "):
                return path
        # Variable font 反過來：GDI 會列出「Noto Sans TC Black」等 named instance，
        # 檔案內只有基底家族「Noto Sans TC」。同一份 VF 檔即可渲染所有 instance。
        prefixes = [
            (name, path) for name, path in _files.items() if key.startswith(name + " ")
        ]
        if prefixes:
            return max(prefixes, key=lambda item: len(item[0]))[1]
    return None


def grouped() -> list[dict]:
    """依語系分組,中文排最上面——找中文字型不用在幾百個西文字型裡撈。

    每個項目是 {"name": 顯示用的本地化名, "en": 英文名};兩個一樣時省略 en。
    """
    buckets: dict[str, list[dict]] = {g: [] for g in GROUP_ORDER}
    for name, en in list_families():
        entry = {"name": name} if en == name else {"name": name, "en": en}
        buckets[_lang_of(name)].append(entry)
    return [{"label": g, "fonts": buckets[g]} for g in GROUP_ORDER if buckets[g]]
