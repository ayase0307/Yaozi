import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { SubtitleStyle } from "./types";

/** 字幕外觀設定面板。
 *
 *  字型清單是後端列舉出來的「系統已安裝字型」——同一個家族名瀏覽器與 libass 都認得,
 *  所以左邊影片上的預覽跟燒出來的成品會是同一套字。要新字型就把字型檔裝進 Windows,
 *  重開伺服器後就會出現在清單裡(列舉結果整個行程只抓一次)。
 */
export default function StylePanel({
  value,
  onChange,
  onClose,
}: {
  value: SubtitleStyle;
  onChange: (s: SubtitleStyle) => void;
  onClose: () => void;
}) {
  const [families, setFamilies] = useState<string[]>([]);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api
      .getFonts()
      .then((f) => setFamilies(f.families))
      .catch(() => {});
  }, []);

  // 拖滑桿會連續觸發,存檔延後 400ms;預覽本身是即時的
  const update = (patch: Partial<SubtitleStyle>) => {
    const next = { ...value, ...patch };
    onChange(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.saveStyle(next).catch(() => {});
    }, 400);
  };

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  return (
    <div className="fix-panel" role="dialog" aria-label="字幕外觀">
      <div className="fix-head">
        <span className="fix-title">字幕外觀</span>
        <span className="toolbar-spacer" />
        <button className="btn small" onClick={onClose}>
          關閉
        </button>
      </div>

      <div className="style-body">
        <label className="style-row">
          <span className="style-label">字型</span>
          <input
            className="style-input"
            list="font-families"
            value={value.font}
            onChange={(e) => update({ font: e.target.value })}
            placeholder="打字可搜尋"
          />
        </label>
        <datalist id="font-families">
          {families.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <p className="style-hint">
          清單是這台電腦裝好的 {families.length} 套字型。想用新的開源字型,先安裝到 Windows
          再重開伺服器。
        </p>

        <Slider
          label="字級"
          value={value.size}
          min={2}
          max={14}
          step={0.1}
          suffix="% 畫面高"
          onChange={(size) => update({ size })}
        />
        <Slider
          label="外框"
          value={value.outline}
          min={0}
          max={1.5}
          step={0.05}
          suffix="% 畫面高"
          onChange={(outline) => update({ outline })}
        />
        <Slider
          label="離底邊"
          value={value.bottom}
          min={0}
          max={40}
          step={0.5}
          suffix="% 畫面高"
          onChange={(bottom) => update({ bottom })}
        />

        <div className="style-row">
          <span className="style-label">顏色</span>
          <input
            type="color"
            className="style-color"
            value={value.color}
            onChange={(e) => update({ color: e.target.value })}
            aria-label="字幕顏色"
          />
          <input
            type="color"
            className="style-color"
            value={value.outline_color}
            onChange={(e) => update({ outline_color: e.target.value })}
            aria-label="外框顏色"
          />
          <label className="style-check">
            <input
              type="checkbox"
              checked={value.bold}
              onChange={(e) => update({ bold: e.target.checked })}
            />
            粗體
          </label>
        </div>

        <div className="style-preview" style={{ fontFamily: `"${value.font}"` }}>
          <span
            style={{
              color: value.color,
              fontWeight: value.bold ? 700 : 400,
              WebkitTextStroke: `${value.outline * 2}px ${value.outline_color}`,
              paintOrder: "stroke fill",
            }}
          >
            這是字幕預覽 Sample 123
          </span>
        </div>

        <p className="style-hint">
          尺寸都是佔畫面高度的百分比,所以同一組設定套到 1080p 與 4K 會等比放大。
          左邊影片上的字幕就是實際比例,調完直接「匯出 → 成品影片」即可。
        </p>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="style-row">
      <span className="style-label">{label}</span>
      <input
        type="range"
        className="style-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="style-value mono">
        {value.toFixed(step < 0.1 ? 2 : 1)}
        <span className="style-unit">{suffix}</span>
      </span>
    </label>
  );
}
