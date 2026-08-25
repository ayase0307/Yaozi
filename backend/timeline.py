"""非破壞式剪輯時間軸工具。

來源時間仍用原影片秒數儲存；輸出時才根據頭尾 trim 與中間 omit_ranges
計算保留區段、字幕裁切和平移。這樣使用者之後刪除剪除範圍就能完整復原。
"""

from __future__ import annotations


def clean_omit_ranges(raw, duration: float | None, trim: dict | None = None) -> list[dict]:
    if not isinstance(raw, list):
        return []
    lower = float(trim["start"]) if trim else 0.0
    upper = float(trim["end"]) if trim else float(duration or 0)
    if upper <= lower:
        return []
    ranges = []
    for item in raw[:100]:
        if not isinstance(item, dict):
            continue
        try:
            start = max(lower, float(item["start"]))
            end = min(upper, float(item["end"]))
        except (KeyError, TypeError, ValueError):
            continue
        if end - start >= 0.1:
            ranges.append({"start": start, "end": end})
    ranges.sort(key=lambda item: item["start"])
    merged: list[dict] = []
    for item in ranges:
        if merged and item["start"] <= merged[-1]["end"] + 0.02:
            merged[-1]["end"] = max(merged[-1]["end"], item["end"])
        else:
            merged.append(dict(item))
    return [
        {"start": round(item["start"], 3), "end": round(item["end"], 3)}
        for item in merged
        if item["end"] - item["start"] >= 0.1
    ]


def kept_intervals(duration: float, trim: dict | None, omit_ranges: list[dict] | None) -> list[dict]:
    start = float(trim["start"]) if trim else 0.0
    end = float(trim["end"]) if trim else float(duration)
    if end <= start:
        return []
    omits = clean_omit_ranges(omit_ranges, duration, trim)
    kept = []
    cursor = start
    for item in omits:
        if item["start"] > cursor + 0.001:
            kept.append({"start": round(cursor, 3), "end": round(item["start"], 3)})
        cursor = max(cursor, item["end"])
    if cursor < end - 0.001:
        kept.append({"start": round(cursor, 3), "end": round(end, 3)})
    return kept


def edited_duration(duration: float, trim: dict | None, omit_ranges: list[dict] | None) -> float:
    return round(sum(item["end"] - item["start"] for item in kept_intervals(duration, trim, omit_ranges)), 3)


def apply_edits(
    segments: list[dict],
    duration: float,
    trim: dict | None,
    omit_ranges: list[dict] | None,
) -> list[dict]:
    """裁掉不要的時間並把字幕平移到輸出時間軸；跨越剪點的字幕會被切開。"""
    intervals = kept_intervals(duration, trim, omit_ranges)
    if not intervals:
        return []
    out = []
    output_cursor = 0.0
    for interval_index, interval in enumerate(intervals):
        a, b = interval["start"], interval["end"]
        for segment in segments:
            start = max(float(segment["start"]), a)
            end = min(float(segment["end"]), b)
            if end - start < 0.03:
                continue
            item = {
                **segment,
                "start": round(output_cursor + start - a, 3),
                "end": round(output_cursor + end - a, 3),
            }
            if start > float(segment["start"]) + 0.001 or end < float(segment["end"]) - 0.001:
                item["id"] = f"{segment.get('id', 'seg')}-{interval_index}"
            out.append(item)
        output_cursor += b - a
    out.sort(key=lambda item: (item["start"], item["end"]))
    return out
