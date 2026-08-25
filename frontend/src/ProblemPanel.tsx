import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  formatTime,
  readingSpeed,
  type SegmentProblemInfo,
  type SegmentProblemKind,
} from "./segments";
import type { Segment } from "./types";

export interface ProblemItem {
  index: number;
  segment: Segment;
  problem: SegmentProblemInfo;
}

const FILTERS: { kind: SegmentProblemKind | "all"; label: string }[] = [
  { kind: "all", label: "全部" },
  { kind: "overlap", label: "重疊" },
  { kind: "too_short", label: "太短" },
  { kind: "too_fast", label: "太快" },
  { kind: "fast", label: "偏快" },
  { kind: "too_long", label: "太長" },
  { kind: "empty", label: "空白" },
  { kind: "missing_translation", label: "缺譯文" },
];

export default function ProblemPanel({
  items,
  selectedIndex,
  onSelect,
  onNext,
  onClose,
}: {
  items: ProblemItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<SegmentProblemKind | "all">("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => {
    const next = new Map<SegmentProblemKind, number>();
    for (const item of items) {
      next.set(item.problem.kind, (next.get(item.problem.kind) ?? 0) + 1);
    }
    return next;
  }, [items]);
  const visibleItems = useMemo(
    () => (filter === "all" ? items : items.filter((item) => item.problem.kind === filter)),
    [filter, items]
  );
  const virtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 74,
    overscan: 8,
    getItemKey: (index) => visibleItems[index]?.segment.id ?? index,
  });

  useEffect(() => {
    if (visibleItems.length) virtualizer.scrollToIndex(0, { align: "start" });
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className="fix-panel problem-panel" role="dialog" aria-label="字幕問題中心">
      <div className="fix-head problem-head">
        <div>
          <span className="fix-title">問題中心</span>
          <span className="problem-summary">{items.length} 句待處理</span>
        </div>
        <span className="toolbar-spacer" />
        <button className="btn small primary" onClick={onNext} disabled={!items.length}>
          下一個 (N)
        </button>
        <button className="btn small" onClick={onClose}>
          關閉
        </button>
      </div>

      <div className="problem-filters" role="group" aria-label="問題類型">
        {FILTERS.map(({ kind, label }) => {
          const count = kind === "all" ? items.length : counts.get(kind) ?? 0;
          if (kind !== "all" && !count) return null;
          return (
            <button
              key={kind}
              type="button"
              className={"problem-filter" + (filter === kind ? " on" : "")}
              aria-pressed={filter === kind}
              onClick={() => setFilter(kind)}
            >
              {label}
              <span className="mono">{count}</span>
            </button>
          );
        })}
      </div>

      {visibleItems.length ? (
        <div className="problem-list" ref={scrollRef}>
          <div
            className="problem-virtual-list"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = visibleItems[virtualRow.index];
              const seg = item.segment;
              return (
                <button
                  key={item.segment.id}
                  type="button"
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={"problem-item" + (selectedIndex === item.index ? " selected" : "")}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  aria-current={selectedIndex === item.index ? "true" : undefined}
                  onClick={() => onSelect(item.index)}
                >
                  <span className="problem-item-top">
                    <span className="mono">{formatTime(seg.start)}</span>
                    <span className={`problem-kind kind-${item.problem.kind}`}>
                      {item.problem.label}
                    </span>
                  </span>
                  <span className="problem-text">{seg.text || "（空白字幕）"}</span>
                  <span className="problem-meta">
                    {(seg.end - seg.start).toFixed(2)} 秒 · {readingSpeed(seg).toFixed(1)} 字寬/秒
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="problem-empty">
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
            <path
              d="m5 12 4 4L19 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <strong>{items.length ? "這一類已經清完" : "目前沒有問題句"}</strong>
          <span>{items.length ? "切換其他類型繼續校對。" : "可以直接進入匯出前檢查。"}</span>
        </div>
      )}
    </aside>
  );
}
