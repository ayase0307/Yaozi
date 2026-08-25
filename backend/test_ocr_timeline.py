"""OCR 字幕合併與非破壞式剪輯的快速自我檢查。"""

from . import ocr, timeline


def _row(text: str, cy: float, score: float = 0.95) -> dict:
    return {"text": text, "cy": cy, "height": 20, "score": score}


def run() -> None:
    bilingual = ocr.observation_from_rows(
        [_row("Hello world", 20), _row("哈囉世界", 55)], "auto"
    )
    assert bilingual and bilingual["text"] == "Hello world"
    assert bilingual["trans"] == "哈囉世界"

    wrapped = ocr.observation_from_rows(
        [_row("這是一句很長的", 20), _row("中文字幕", 48)], "auto"
    )
    assert wrapped and wrapped["trans"] is None
    assert wrapped["text"] == "這是一句很長的中文字幕"

    segments = ocr.observations_to_segments(
        [
            (0.0, {"text": "第一句", "trans": None, "score": 0.8}),
            (0.5, {"text": "第一句。", "trans": None, "score": 0.95}),
            (1.0, None),
            (1.5, {"text": "第二句", "trans": "Second", "score": 0.9}),
            (2.0, {"text": "第二句", "trans": "Second", "score": 0.9}),
        ],
        0.5,
        3.0,
    )
    assert len(segments) == 2, segments
    assert segments[0]["start"] == 0 and segments[0]["end"] == 0.75
    assert segments[1]["trans"] == "Second"

    omits = timeline.clean_omit_ranges(
        [{"start": 3, "end": 4}, {"start": 3.8, "end": 5}, {"start": 8, "end": 8.05}],
        10,
        {"start": 1, "end": 9},
    )
    assert omits == [{"start": 3.0, "end": 5.0}], omits
    kept = timeline.kept_intervals(10, {"start": 1, "end": 9}, omits)
    assert kept == [{"start": 1.0, "end": 3.0}, {"start": 5.0, "end": 9.0}], kept
    assert timeline.edited_duration(10, {"start": 1, "end": 9}, omits) == 6

    edited = timeline.apply_edits(
        [
            {"id": "a", "start": 2, "end": 4, "text": "跨過剪點"},
            {"id": "b", "start": 5.5, "end": 6, "text": "保留"},
        ],
        10,
        {"start": 1, "end": 9},
        omits,
    )
    assert [(item["start"], item["end"]) for item in edited] == [(1.0, 2.0), (2.5, 3.0)]


if __name__ == "__main__":
    run()
    print("ocr/timeline selfcheck ok")
