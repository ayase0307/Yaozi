"""字幕樣式的最小自我檢查:python -m backend.test_style

只測會壞掉出事的兩件事:外來輸入有沒有被夾回合法範圍、顏色有沒有正確轉成 ASS 的 BGR。
"""

from . import exporter, style


def test_clean_clamps_and_rejects_junk():
    dirty = {
        "font": "壞字型,Name\n{x}",  # 逗號與換行會讓 ASS 的 Style 行錯位
        "size": 999,
        "outline": -5,
        "bottom": "不是數字",
        "color": "紅色",
        "outline_color": "#aabbcc",
        "bold": 0,
    }
    got = style.clean(dirty)
    assert got["font"] == "壞字型Namex", got["font"]
    assert got["size"] == 20.0, got["size"]
    assert got["outline"] == 0.0, got["outline"]
    assert got["bottom"] == style.DEFAULTS["bottom"], got["bottom"]
    assert got["color"] == style.DEFAULTS["color"], got["color"]
    assert got["outline_color"] == "#AABBCC", got["outline_color"]
    assert got["bold"] is False


def test_clean_keeps_good_values():
    got = style.clean({"font": "Noto Sans TC", "size": 6, "color": "#ff8800", "bold": True})
    assert got["font"] == "Noto Sans TC"
    assert got["size"] == 6.0
    assert got["color"] == "#FF8800"
    assert got["bold"] is True


def test_ass_color_is_bgr():
    assert exporter._ass_color("#FF8800") == "&H000088FF"
    assert exporter._ass_color("#FFFFFF") == "&H00FFFFFF"
    assert exporter._ass_color("#000000") == "&H00000000"


def test_to_ass_uses_style_and_scales_with_height():
    segments = [{"start": 0.0, "end": 1.0, "text": "測試"}]
    st = style.clean({"font": "Noto Sans TC", "size": 10, "color": "#FF0000", "bold": False})
    out = exporter.to_ass(segments, 1920, 1080, st)
    # 1080 的 10% = 108
    assert "Style: Default,Noto Sans TC,108,&H000000FF," in out, out
    assert ",0,0,0,0,100,100," in out  # bold=False
    # 同樣的樣式換到 4K 應該等比放大
    assert "Style: Default,Noto Sans TC,216," in exporter.to_ass(segments, 3840, 2160, st)


def test_to_ass_without_style_falls_back_to_defaults():
    out = exporter.to_ass([{"start": 0.0, "end": 1.0, "text": "測試"}], 1920, 1080)
    assert f"Style: Default,{style.DEFAULTS['font']}," in out


def test_ass_color_opacity_is_inverted_alpha():
    # ASS 的 AA 是「透明度」:100% 不透明 = 00,0% = FF
    assert exporter._ass_color("#000000", 100) == "&H00000000"
    assert exporter._ass_color("#000000", 0) == "&HFF000000"
    assert exporter._ass_color("#000000", 60) == "&H66000000"


def test_to_ass_box_and_alignment():
    st = style.clean({"border": "box", "align": "left", "vertical": "top", "outline": 1.0})
    out = exporter.to_ass([{"start": 0, "end": 1, "text": "測試"}], 1920, 1080, st)
    line = next(x for x in out.splitlines() if x.startswith("Style:"))
    fields = line.split(",")
    assert fields[15] == "3", fields  # BorderStyle=3 才是整塊底框
    assert fields[16] == "11", fields  # 1080 的 1% 當框內距
    assert fields[18] == "7", fields  # 左上 = 7
    # 邊框關掉時粗細必須歸零,否則 libass 照樣描邊
    none_out = exporter.to_ass(
        [{"start": 0, "end": 1, "text": "測試"}], 1920, 1080, style.clean({"border": "none"})
    )
    assert next(x for x in none_out.splitlines() if x.startswith("Style:")).split(",")[16] == "0"


def test_wrap_text():
    assert exporter.wrap_text("短句", 20) == ["短句"]
    assert exporter.wrap_text("很長的一句話", 0) == ["很長的一句話"]  # 0 = 不斷行
    # 兩行內優先斷在標點後面
    assert exporter.wrap_text("今天天氣很好,我們出去走走吧", 10) == ["今天天氣很好,", "我們出去走走吧"]
    # 沒有標點就對半切
    assert exporter.wrap_text("一二三四五六七八", 5) == ["一二三四", "五六七八"]
    # 超過兩行就照字數硬切,每行都不超過上限
    assert all(len(x) <= 6 for x in exporter.wrap_text("一二三四五六七八九十" * 3, 6))


def test_to_ass_bilingual_and_wrapping():
    st = style.clean({"max_chars": 6})
    seg = [{"start": 0, "end": 1, "text": "一二三四五六七八", "trans": "abcdefghij"}]
    events = [l for l in exporter.to_ass(seg, 1920, 1080, st).splitlines() if l.startswith("Dialogue")]
    assert len(events) == 2, events  # 原文與譯文各一個事件,才能各自設樣式
    orig, trans = events
    assert orig.count("\\N") == 1 and trans.count("\\N") == 1, events  # 各自折成兩行
    assert ",Default," in orig and ",Trans," in trans, events
    assert orig.split(",")[0] != trans.split(",")[0], "兩個事件要在不同 Layer,否則 libass 會判定重疊"
    # 貼下時原文要往上讓開譯文的高度,MarginV 必須比譯文大
    assert int(orig.split(",")[7]) > int(trans.split(",")[7]), events
    assert exporter.to_srt_bi(seg).count("\n一二三四五六七八\nabcdefghij") == 1


def test_split_long_sentences():
    from . import transcriber

    def w(word, a, b):
        return {"word": word, "start": a, "end": b}

    seg = {
        "id": "x", "start": 0.0, "end": 6.0,
        "text": "今天天氣真好,我們一起出去walk走走看看吧",
        "words": [w("今天天氣真好,", 0, 1.5), w("我們一起出去", 1.5, 3.0),
                  w("walk走走", 3.4, 4.5), w("看看吧", 4.5, 6.0)],
    }
    out = transcriber._split_long([seg], 12)
    assert len(out) > 1, out
    assert all(len(s["text"]) <= 14 for s in out), out  # 只能切在單字邊界,允許小幅超出
    assert out[0]["text"].endswith(","), out[0]  # 有標點就優先斷在標點後
    assert out[0]["end"] == out[1]["start"], out  # 時間軸不能有洞
    assert "".join(s["text"] for s in out).replace(" ", "") == seg["text"].replace(" ", "")
    # 沒有單字時間戳就不能亂切,寧可留長句
    bare = {"id": "y", "start": 0, "end": 3, "text": "一" * 40, "words": []}
    assert transcriber._split_long([bare], 12) == [bare]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"OK  {name}")
    print("全部通過")
