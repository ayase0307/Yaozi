from . import style as style_module


def _fmt_time(t: float, ms_sep: str) -> str:
    if t < 0:
        t = 0.0
    ms = round(t * 1000)
    h, rem = divmod(ms, 3600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{ms_sep}{ms:03d}"


def to_srt(segments: list[dict]) -> str:
    blocks = []
    for i, s in enumerate(segments, 1):
        blocks.append(
            f"{i}\n{_fmt_time(s['start'], ',')} --> {_fmt_time(s['end'], ',')}\n{s['text']}\n"
        )
    return "\n".join(blocks)


def to_vtt(segments: list[dict]) -> str:
    blocks = ["WEBVTT\n"]
    for s in segments:
        blocks.append(
            f"{_fmt_time(s['start'], '.')} --> {_fmt_time(s['end'], '.')}\n{s['text']}\n"
        )
    return "\n".join(blocks)


def to_srt_bi(segments: list[dict]) -> str:
    """雙語 SRT:原文在上、譯文在下。沒翻的句子就只有原文。"""
    bi = [
        {**s, "text": f"{s['text']}\n{s['trans']}" if s.get("trans") else s["text"]}
        for s in segments
    ]
    return to_srt(bi)


def to_txt(segments: list[dict]) -> str:
    return "\n".join(s["text"] for s in segments) + "\n"


def to_txt_ts(segments: list[dict]) -> str:
    lines = []
    for s in segments:
        m, sec = divmod(int(s["start"]), 60)
        h, m = divmod(m, 60)
        stamp = f"{h}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"
        lines.append(f"[{stamp}] {s['text']}")
    return "\n".join(lines) + "\n"


def _ass_time(t: float) -> str:
    if t < 0:
        t = 0.0
    cs = round(t * 100)
    h, rem = divmod(cs, 360_000)
    m, rem = divmod(rem, 6_000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:
    # 大括號在 ASS 是樣式控制碼,換行用 \N
    return text.replace("{", "(").replace("}", ")").replace("\n", "\\N")


def _ass_color(hex_color: str, opacity: int = 100) -> str:
    """#RRGGBB → ASS 的 &HAABBGGRR。BGR 反序,開頭 AA 是「透明度」——0 不透明、FF 全透。"""
    r, g, b = hex_color[1:3], hex_color[3:5], hex_color[5:7]
    alpha = round((100 - min(max(opacity, 0), 100)) * 255 / 100)
    return f"&H{alpha:02X}{b}{g}{r}".upper()


# 斷行優先挑這些字元後面,句子才不會斷在詞中間
_BREAK_AFTER = "，。、；：？！,.;:?! "


def wrap_text(text: str, max_chars: int) -> list[str]:
    """把一句拆成每行不超過 max_chars 字。

    中文沒有空格,libass 的自動換行只會照畫面寬度硬折,常常折出「上面一長行、
    下面兩個字」。這裡自己折:剛好兩行時盡量等長,並優先斷在標點後面。
    """
    text = text.strip()
    if max_chars <= 0 or len(text) <= max_chars:
        return [text]
    if len(text) <= max_chars * 2:
        mid = len(text) // 2
        cuts = [
            i
            for i in range(1, len(text))
            if text[i - 1] in _BREAK_AFTER and i <= max_chars and len(text) - i <= max_chars
        ]
        best = min(cuts, key=lambda i: abs(i - mid)) if cuts else mid
        return [text[:best].strip(), text[best:].strip()]
    return [text[i : i + max_chars].strip() for i in range(0, len(text), max_chars)]


# 水平 × 垂直 → ASS 的 Alignment(數字鍵盤方位:1~3 貼底、7~9 貼頂)
_ALIGN = {
    ("left", "bottom"): 1, ("center", "bottom"): 2, ("right", "bottom"): 3,
    ("left", "top"): 7, ("center", "top"): 8, ("right", "top"): 9,
}


def to_ass(segments: list[dict], width: int, height: int, style: dict | None = None) -> str:
    """燒錄用 ASS 字幕。尺寸全部是「佔畫面高度的百分比」乘回實際畫面,換解析度自動縮放。"""
    st = {**style_module.DEFAULTS, **(style or {})}
    fs = max(round(height * st["size"] / 100), 16)
    # none 模式仍走 BorderStyle 1,只是把邊框粗細歸零
    border_style = 3 if st["border"] == "box" else 1
    outline = 0 if st["border"] == "none" else max(round(height * st["outline"] / 100), 0)
    shadow = max(round(height * st["shadow"] / 100), 0)
    spacing = round(height * st["spacing"] / 100, 1)
    margin_v = max(round(height * st["bottom"] / 100), 0)
    margin_lr = max(round(width * st["side"] / 100), 0)
    primary = _ass_color(st["color"])
    # BorderStyle=3 時 libass 是拿 OutlineColour 去填整塊底框
    outline_colour = _ass_color(st["outline_color"], st["outline_opacity"])
    back_colour = _ass_color(st["shadow_color"], st["shadow_opacity"])
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n"
        "WrapStyle: 2\n"  # 2 = 只認我們自己插的 \N,不讓 libass 亂折行
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{st['font']},{fs},{primary},{primary},"
        f"{outline_colour},{back_colour},{-1 if st['bold'] else 0},"
        f"{-1 if st['italic'] else 0},0,0,100,100,{spacing},0,"
        f"{border_style},{outline},{shadow},"
        f"{_ALIGN[(st['align'], st['vertical'])]},{margin_lr},{margin_lr},{margin_v},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    events = []
    for s in segments:
        if not s["text"].strip():
            continue
        lines = wrap_text(s["text"], st["max_chars"])
        if s.get("trans"):
            lines += wrap_text(s["trans"], st["max_chars"])
        text = "\n".join(lines)
        events.append(
            f"Dialogue: 0,{_ass_time(s['start'])},{_ass_time(s['end'])},Default,,0,0,0,,"
            f"{_ass_escape(text)}"
        )
    return header + "\n".join(events) + "\n"


# format -> (轉換函式, 副檔名, MIME, 是否加 BOM)
# SRT/TXT 加 BOM,Premiere/剪映等軟體讀中文比較不會亂碼;VTT 規範上以 WEBVTT 開頭,不加。
FORMATS = {
    "srt": (to_srt, "srt", "application/x-subrip", True),
    "srt-bi": (to_srt_bi, "srt", "application/x-subrip", True),
    "vtt": (to_vtt, "vtt", "text/vtt", False),
    "txt": (to_txt, "txt", "text/plain", True),
    "txt-ts": (to_txt_ts, "txt", "text/plain", True),
}


def export(segments: list[dict], fmt: str, name: str) -> tuple[str, bytes, str]:
    if fmt not in FORMATS:
        raise ValueError(f"不支援的格式:{fmt}")
    fn, ext, mime, bom = FORMATS[fmt]
    if fmt in ("srt", "srt-bi", "vtt"):
        # 字幕檔照樣式裡的每行字數斷行;逐字稿是拿來讀的,不要斷
        max_chars = style_module.load()["max_chars"]
        segments = [
            {
                **s,
                "text": "\n".join(wrap_text(s["text"], max_chars)),
                **({"trans": "\n".join(wrap_text(s["trans"], max_chars))} if s.get("trans") else {}),
            }
            for s in segments
        ]
    content = fn(segments).encode("utf-8-sig" if bom else "utf-8")
    suffix = "_逐字稿" if fmt.startswith("txt") else "_雙語" if fmt == "srt-bi" else ""
    return f"{name}{suffix}.{ext}", content, mime
