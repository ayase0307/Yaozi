import type { OcrJob, OcrOptions } from "./types";

const CROP_PRESETS = [
  { label: "底部 40%", note: "一般橫式字幕", top: 0.6, bottom: 0.98 },
  { label: "底部 55%", note: "雙語或直式影片", top: 0.45, bottom: 0.98 },
  { label: "全畫面", note: "字幕位置不固定", top: 0, bottom: 1 },
];

const LAYOUTS: { key: OcrOptions["layout"]; label: string; note: string }[] = [
  { key: "auto", label: "自動判斷", note: "不同語系的上下兩層自動拆成雙語" },
  { key: "single", label: "單語／換行", note: "所有文字合併到原文欄" },
  { key: "bilingual_top", label: "上原文、下譯文", note: "上下兩層分別進原文與譯文" },
  { key: "bilingual_bottom", label: "上譯文、下原文", note: "適合翻譯在畫面上方的影片" },
];

export default function OcrPanel({
  options,
  job,
  hasTrim,
  onChange,
  onStart,
  onCancel,
  onClose,
}: {
  options: OcrOptions;
  job: OcrJob | null;
  hasTrim: boolean;
  onChange: (options: OcrOptions) => void;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const running = job?.status === "running";
  const percent = Math.round((job?.progress ?? 0) * 100);
  return (
    <aside className="fix-panel ocr-panel" role="dialog" aria-label="硬字幕 OCR 設定">
      <div className="fix-head ocr-head">
        <div>
          <span className="fix-title">硬字幕 OCR</span>
          <span className="problem-summary">畫面文字 → 可編輯字幕與時間軸</span>
        </div>
        <span className="toolbar-spacer" />
        <button className="icon-btn" onClick={onClose} aria-label="關閉 OCR 設定">
          ×
        </button>
      </div>

      <div className="ocr-body">
        <section className="ocr-section">
          <div className="ocr-section-head">
            <strong>1. 掃描區域</strong>
            <span>綠框內才會辨識</span>
          </div>
          <div className="ocr-preset-grid">
            {CROP_PRESETS.map((preset) => {
              const selected =
                Math.abs(options.crop_top - preset.top) < 0.01 &&
                Math.abs(options.crop_bottom - preset.bottom) < 0.01;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={selected ? "selected" : ""}
                  aria-pressed={selected}
                  onClick={() => onChange({ ...options, crop_top: preset.top, crop_bottom: preset.bottom })}
                  disabled={running}
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.note}</span>
                </button>
              );
            })}
          </div>
          <div className="ocr-crop-numbers">
            <label>
              從畫面上方
              <input
                type="number"
                min={0}
                max={90}
                step={1}
                value={Math.round(options.crop_top * 100)}
                disabled={running}
                onChange={(event) =>
                  onChange({
                    ...options,
                    crop_top: Math.min(Number(event.target.value) / 100, options.crop_bottom - 0.08),
                  })
                }
              />
              % 開始
            </label>
            <label>
              到
              <input
                type="number"
                min={8}
                max={100}
                step={1}
                value={Math.round(options.crop_bottom * 100)}
                disabled={running}
                onChange={(event) =>
                  onChange({
                    ...options,
                    crop_bottom: Math.max(Number(event.target.value) / 100, options.crop_top + 0.08),
                  })
                }
              />
              %
            </label>
          </div>
        </section>

        <section className="ocr-section">
          <div className="ocr-section-head">
            <strong>2. 字幕版面</strong>
            <span>OCR 可直接建立雙語欄位</span>
          </div>
          <div className="ocr-layout-list">
            {LAYOUTS.map((layout) => (
              <label key={layout.key} className={options.layout === layout.key ? "selected" : ""}>
                <input
                  type="radio"
                  name="ocr-layout"
                  value={layout.key}
                  checked={options.layout === layout.key}
                  disabled={running}
                  onChange={() => onChange({ ...options, layout: layout.key })}
                />
                <span>
                  <strong>{layout.label}</strong>
                  <small>{layout.note}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="ocr-section ocr-run-options">
          <label>
            掃描精度
            <select
              className="select"
              value={options.sample_rate}
              disabled={running}
              onChange={(event) => onChange({ ...options, sample_rate: Number(event.target.value) })}
            >
              <option value={1}>快速 · 每秒 1 張</option>
              <option value={2}>標準 · 每秒 2 張</option>
              <option value={4}>精細 · 每秒 4 張</option>
            </select>
          </label>
          {hasTrim && (
            <label className="ocr-check">
              <input
                type="checkbox"
                checked={options.use_trim}
                disabled={running}
                onChange={(event) => onChange({ ...options, use_trim: event.target.checked })}
              />
              只掃描目前的頭尾剪輯範圍
            </label>
          )}
        </section>

        <p className="ocr-note">
          中英字幕辨識效果最佳。開始後會備份目前字幕，再以 OCR 結果取代；影片不會上傳。
        </p>
      </div>

      <div className="ocr-actions">
        {running ? (
          <>
            <div className="ocr-progress" role="status" aria-live="polite">
              <span>
                掃描中 {percent}% · {job?.processed ?? 0}/{job?.total ?? "…"} 張
              </span>
              <span className="bar">
                <span className="bar-fill" style={{ width: `${percent}%` }} />
              </span>
            </div>
            <button className="btn" onClick={onCancel}>取消</button>
          </>
        ) : (
          <button className="btn primary ocr-start" onClick={onStart}>
            開始掃描並建立字幕
          </button>
        )}
      </div>
    </aside>
  );
}
