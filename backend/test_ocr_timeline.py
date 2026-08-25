"""OCR 字幕合併與非破壞式剪輯的快速自我檢查。"""

import os
import numpy as np

from . import ocr, timeline


def _row(text: str, cy: float, score: float = 0.95) -> dict:
    return {"text": text, "cy": cy, "height": 20, "score": score}


def run() -> None:
    # provider 開關:cpu 強制關、dml/gpu 強制開,auto 交給機器自己判斷
    os.environ["YAOZI_OCR_PROVIDER"] = "cpu"
    assert ocr._use_dml() is False
    os.environ["YAOZI_OCR_PROVIDER"] = "dml"
    assert ocr._use_dml() is True
    os.environ["YAOZI_OCR_PROVIDER"] = "GPU"
    assert ocr._use_dml() is True
    del os.environ["YAOZI_OCR_PROVIDER"]
    assert isinstance(ocr._use_dml(), bool)

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

    # 差異預篩:同畫面沿用結果、字幕出現要重新辨識、形狀不同不算相似
    base = np.full((40, 240), 100, dtype="uint8")
    sig = ocr._diff_signature(base)
    assert ocr.crops_similar(sig, ocr._diff_signature(base + 2)), "雜訊不該觸發重跑"
    with_text = base.copy()
    with_text[10:30, 60:180] = 250  # 模擬字幕亮帶出現
    assert not ocr.crops_similar(sig, ocr._diff_signature(with_text)), "字幕變化必須重跑"
    other_size = np.zeros((80, 480), dtype="uint8")
    assert not ocr.crops_similar(sig, ocr._diff_signature(other_size))


if __name__ == "__main__":
    run()
    print("ocr/timeline selfcheck ok")
