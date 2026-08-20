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


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"OK  {name}")
    print("全部通過")
