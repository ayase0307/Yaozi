import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import FontPicker from "./FontPicker";
import type { SubtitleStyle } from "./types";

/** 字幕外觀的控制項本體。編輯器側邊面板與設定頁共用同一份,調哪邊都是同一組全域設定。 */
export default function StyleControls({
  value,
  onChange,
}: {
  value: SubtitleStyle;
  onChange: (s: SubtitleStyle) => void;
}) {
  const saveTimer = useRef<number | undefined>(undefined);

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
    <div className="style-body">
      <div className="style-row">
        <span className="style-label">字型</span>
        <FontPicker value={value.font} onChange={(font) => update({ font })} placeholder="" />
      </div>

      <Slider
        label="字級"
        value={value.size}
        min={2}
        max={14}
        step={0.1}
        onChange={(size) => update({ size })}
      />
      <Slider
        label="外框"
        value={value.outline}
        min={0}
        max={1.5}
        step={0.05}
        onChange={(outline) => update({ outline })}
      />
      <Slider
        label="離底邊"
        value={value.bottom}
        min={0}
        max={40}
        step={0.5}
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

      <StyleSim value={value} />

      <p className="style-hint">
        尺寸都是佔畫面高度的百分比,所以同一組設定套到 1080p 與 4K 會等比放大。
        想用新的開源字型,先安裝到 Windows 再重開伺服器就會出現在清單裡。
      </p>
    </div>
  );
}

const SAMPLES = ["這是字幕的模擬預覽", "字級、外框、位置都照實際比例", "Mixed 中英 123 測試"];

/** 字幕模擬區:16:9 假畫面,字級與離底邊都照畫面高度換算,看到的比例就是燒出來的比例。 */
function StyleSim({ value }: { value: SubtitleStyle }) {
  const [light, setLight] = useState(false);
  const [line, setLine] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="style-sim">
      <div className="style-sim-head">
        <span className="style-label">模擬</span>
        <button className="link-btn" onClick={() => setLine((i) => (i + 1) % SAMPLES.length)}>
          換一句
        </button>
        <button className="link-btn" onClick={() => setLight((v) => !v)}>
          {light ? "換深色背景" : "換淺色背景"}
        </button>
      </div>
      <div ref={box} className={"style-sim-frame" + (light ? " light" : "")}>
        <span
          className="style-sim-text"
          style={{
            fontFamily: `"${value.font}"`,
            fontSize: h * (value.size / 100) || undefined,
            fontWeight: value.bold ? 700 : 400,
            color: value.color,
            bottom: `${value.bottom}%`,
            WebkitTextStroke: `${h * (value.outline / 100)}px ${value.outline_color}`,
            paintOrder: "stroke fill",
          }}
        >
          {SAMPLES[line]}
        </span>
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
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
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
        <span className="style-unit">% 畫面高</span>
      </span>
    </label>
  );
}
