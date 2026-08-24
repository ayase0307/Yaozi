import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "./api";
import FontPicker, { fontStack } from "./FontPicker";
import Hint from "./Hint";
import type { SubtitleStyle } from "./types";
import { t } from "./i18n";

// 斷行規則要跟 backend/exporter.py 的 wrap_text 一致,預覽才等於燒出來的樣子
const BREAK_AFTER = "，。、；：？！,.;:?! ";

/** 把一句拆成每行不超過 maxChars 字。剛好兩行時盡量等長,並優先斷在標點後面。 */
export function wrapText(text: string, maxChars: number): string[] {
  text = text.trim();
  if (maxChars <= 0 || text.length <= maxChars) return [text];
  if (text.length <= maxChars * 2) {
    const mid = Math.floor(text.length / 2);
    let best = mid;
    let bestDist = Infinity;
    for (let i = 1; i < text.length; i++) {
      if (!BREAK_AFTER.includes(text[i - 1])) continue;
      if (i > maxChars || text.length - i > maxChars) continue;
      const d = Math.abs(i - mid);
      if (d < bestDist) [best, bestDist] = [i, d];
    }
    return [text.slice(0, best).trim(), text.slice(best).trim()];
  }
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars).trim());
  return out;
}

function rgba(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`;
}

/** 把字幕設定換算成 CSS。h = 畫面高度 px,所有百分比都是對它算的。
 *
 *  ponytail: 底框模式用 CSS 的 background + padding 近似 libass 的 BorderStyle=3,
 *  陰影一律用 text-shadow(libass 在底框模式是整塊框投影)。差在幾個像素,要像素級
 *  對齊就得改成畫 canvas。
 */
export function subStyleCss(
  st: SubtitleStyle,
  h: number
): { wrap: CSSProperties; line: CSSProperties } {
  const px = (pct: number) => (h * pct) / 100;
  const box = st.border === "box";
  const pad = px(st.outline);
  return {
    wrap: {
      position: "absolute",
      left: `${st.side}%`,
      right: `${st.side}%`,
      [st.vertical === "top" ? "top" : "bottom"]: `${st.bottom}%`,
      display: "flex",
      flexDirection: "column",
      alignItems:
        st.align === "left" ? "flex-start" : st.align === "right" ? "flex-end" : "center",
    },
    line: {
      fontFamily: fontStack(st.font),
      fontSize: px(st.size) || undefined,
      fontWeight: st.bold ? 700 : 400,
      fontStyle: st.italic ? "italic" : "normal",
      letterSpacing: px(st.spacing) || undefined,
      color: st.color,
      textAlign: st.align,
      background: box ? rgba(st.outline_color, st.outline_opacity) : undefined,
      padding: box ? `${pad * 0.4}px ${pad}px` : undefined,
      WebkitTextStroke:
        st.border === "outline" && st.outline > 0
          ? `${pad}px ${rgba(st.outline_color, st.outline_opacity)}`
          : undefined,
      paintOrder: "stroke fill",
      textShadow:
        st.shadow > 0
          ? `${px(st.shadow)}px ${px(st.shadow)}px 0 ${rgba(st.shadow_color, st.shadow_opacity)}`
          : undefined,
    },
  };
}

/** 譯文的樣式:沒特別指定的欄位沿用原文,跟 backend/style.py 的 trans_of 一致。 */
export function transStyle(st: SubtitleStyle): SubtitleStyle {
  return {
    ...st,
    font: st.trans_font || st.font,
    size: st.trans_size || st.size,
    color: st.trans_color,
    bold: st.trans_bold,
    italic: st.trans_italic,
  };
}

/** 照設定把一句(含譯文)畫出來——影片上的即時預覽與設定頁的模擬區共用。 */
export function SubtitleLines({
  style,
  height,
  text,
  trans,
}: {
  style: SubtitleStyle;
  height: number;
  text: string;
  trans?: string;
}) {
  const css = subStyleCss(style, height);
  const tcss = subStyleCss(transStyle(style), height);
  return (
    <div className="sub-render" style={css.wrap}>
      {wrapText(text, style.max_chars).map((l, i) => (
        <span key={i} className="sub-render-line" style={css.line}>
          {l}
        </span>
      ))}
      {trans && (
        // 間距做在譯文那一塊上面,原文只有一行時也不會多出空隙
        <div
          className="sub-render-trans"
          style={{ ...css.wrap, position: "static", marginTop: (height * style.trans_gap) / 100 }}
        >
          {wrapText(trans, style.max_chars).map((l, i) => (
            <span key={i} className="sub-render-line" style={tcss.line}>
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

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

  const box = value.border === "box";

  return (
    <div className="style-body">
      <div className="style-row">
        <span className="style-label">{t("字型")}</span>
        <FontPicker value={value.font} onChange={(font) => update({ font })} placeholder="" />
      </div>

      <div className="style-row">
        <span className="style-label">{t("顏色")}</span>
        <input
          type="color"
          className="style-color"
          value={value.color}
          onChange={(e) => update({ color: e.target.value })}
          aria-label={t("文字顏色")}
        />
        <label className="style-check">
          <input
            type="checkbox"
            checked={value.bold}
            onChange={(e) => update({ bold: e.target.checked })}
          />
          {t("粗體")}
        </label>
        <label className="style-check">
          <input
            type="checkbox"
            checked={value.italic}
            onChange={(e) => update({ italic: e.target.checked })}
          />
          {t("斜體")}
        </label>
      </div>

      <Slider label={t("字級")} value={value.size} min={2} max={14} step={0.1} onChange={(size) => update({ size })} />
      <Slider label={t("字距")} value={value.spacing} min={0} max={1} step={0.02} onChange={(spacing) => update({ spacing })} />

      <div className="style-divider" />

      <div className="style-row">
        <span className="style-label">{t("邊框")}</span>
        <Seg
          value={value.border}
          options={[
            ["outline", t("描邊")],
            ["box", t("底框")],
            ["none", t("無")],
          ]}
          onChange={(border) => update({ border: border as SubtitleStyle["border"] })}
        />
        <input
          type="color"
          className="style-color"
          value={value.outline_color}
          onChange={(e) => update({ outline_color: e.target.value })}
          aria-label={box ? t("底框顏色") : t("描邊顏色")}
          disabled={value.border === "none"}
        />
      </div>

      {value.border !== "none" && (
        <>
          <Slider
            label={box ? t("框內距") : t("粗細")}
            value={value.outline}
            min={0}
            max={2}
            step={0.05}
            onChange={(outline) => update({ outline })}
          />
          <Slider
            label={t("不透明")}
            value={value.outline_opacity}
            min={0}
            max={100}
            step={5}
            unit="%"
            digits={0}
            onChange={(outline_opacity) => update({ outline_opacity })}
          />
        </>
      )}

      <div className="style-row">
        <span className="style-label">{t("陰影")}</span>
        <input
          type="color"
          className="style-color"
          value={value.shadow_color}
          onChange={(e) => update({ shadow_color: e.target.value })}
          aria-label={t("陰影顏色")}
        />
        <span className="style-hint style-inline-hint">{t("位移 0 就是關掉陰影")}</span>
      </div>
      <Slider label={t("位移")} value={value.shadow} min={0} max={2} step={0.05} onChange={(shadow) => update({ shadow })} />
      {value.shadow > 0 && (
        <Slider
          label={t("不透明")}
          value={value.shadow_opacity}
          min={0}
          max={100}
          step={5}
          unit="%"
          digits={0}
          onChange={(shadow_opacity) => update({ shadow_opacity })}
        />
      )}

      <div className="style-divider" />

      <div className="style-row">
        <span className="style-label">{t("對齊")}</span>
        <Seg
          value={value.align}
          options={[
            ["left", t("靠左")],
            ["center", t("置中")],
            ["right", t("靠右")],
          ]}
          onChange={(align) => update({ align: align as SubtitleStyle["align"] })}
        />
        <Seg
          value={value.vertical}
          options={[
            ["bottom", t("貼下")],
            ["top", t("貼上")],
          ]}
          onChange={(vertical) => update({ vertical: vertical as SubtitleStyle["vertical"] })}
        />
      </div>

      <Slider
        label={value.vertical === "top" ? t("離頂邊") : t("離底邊")}
        value={value.bottom}
        min={0}
        max={40}
        step={0.5}
        onChange={(bottom) => update({ bottom })}
      />
      <Slider label={t("左右留白")} value={value.side} min={0} max={30} step={0.5} unit={t("% 畫面寬")} onChange={(side) => update({ side })} />
      <Slider
        label={t("每行字數")}
        value={value.max_chars}
        min={0}
        max={40}
        step={1}
        unit={value.max_chars === 0 ? t("不斷行") : t("字")}
        digits={0}
        onChange={(max_chars) => update({ max_chars })}
      />

      <div className="style-divider" />

      <div className="style-row">
        <span className="style-label">{t("譯文")}</span>
        <span className="style-hint style-inline-hint">
          {t("雙語字幕的第二行。邊框、陰影、對齊跟原文共用。")}
        </span>
      </div>
      <div className="style-row">
        <span className="style-label">{t("字型")}</span>
        <FontPicker
          value={value.trans_font}
          onChange={(trans_font) => update({ trans_font })}
          placeholder={t("同原文")}
        />
      </div>
      <div className="style-row">
        <span className="style-label">{t("顏色")}</span>
        <input
          type="color"
          className="style-color"
          value={value.trans_color}
          onChange={(e) => update({ trans_color: e.target.value })}
          aria-label={t("譯文顏色")}
        />
        <label className="style-check">
          <input
            type="checkbox"
            checked={value.trans_bold}
            onChange={(e) => update({ trans_bold: e.target.checked })}
          />
          {t("粗體")}
        </label>
        <label className="style-check">
          <input
            type="checkbox"
            checked={value.trans_italic}
            onChange={(e) => update({ trans_italic: e.target.checked })}
          />
          {t("斜體")}
        </label>
      </div>
      <Slider
        label={t("字級")}
        value={value.trans_size}
        min={0}
        max={14}
        step={0.1}
        unit={value.trans_size === 0 ? t("同原文") : t("% 畫面高")}
        onChange={(trans_size) => update({ trans_size })}
      />
      <Slider
        label={t("行間距")}
        value={value.trans_gap}
        min={0}
        max={6}
        step={0.1}
        onChange={(trans_gap) => update({ trans_gap })}
      />

      <StyleSim value={value} />

      <Hint>
        {t("尺寸都是佔畫面高度的百分比,所以同一組設定套到 1080p 與 4K 會等比放大。每行字數是 Netflix 那類規範的重點:中文一行 14~20 字最好讀。想用新的開源字型,先安裝到 Windows 再重開伺服器就會出現在清單裡。")}
      </Hint>
    </div>
  );
}

// 雙語那句放第一個:譯文的字級、顏色、行間距要看得到才調得動
const SAMPLES: { text: string; trans?: string }[] = [
  { text: t("今天我們來聊聊這個做法為什麼有效"), trans: "Today we'll talk about why this works" },
  { text: t("這是字幕的模擬預覽,字級、邊框、位置都照實際比例換算") },
  { text: t("字距、底框、陰影都可以在這裡先看過再燒錄") },
  { text: t("Mixed 中英 123 測試 ABC") },
];

/** 字幕模擬區:16:9 假畫面,所有尺寸都照畫面高度換算,看到的比例就是燒出來的比例。 */
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

  const sample = SAMPLES[line];
  return (
    <div className="style-sim">
      <div className="style-sim-head">
        <span className="style-label">{t("模擬")}</span>
        <button className="link-btn" onClick={() => setLine((i) => (i + 1) % SAMPLES.length)}>
          {t("換一句")}
        </button>
        <button className="link-btn" onClick={() => setLight((v) => !v)}>
          {light ? t("換深色背景") : t("換淺色背景")}
        </button>
      </div>
      <div ref={box} className={"style-sim-frame" + (light ? " light" : "")}>
        <SubtitleLines style={value} height={h} text={sample.text} trans={sample.trans} />
      </div>
    </div>
  );
}

/** 幾選一的小分段按鈕。用 select 在這種 2~3 選項上點兩次才選得到,直接排成按鈕比較快。 */
function Seg({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <span className="style-seg">
      {options.map(([v, label]) => (
        <button
          key={v}
          className={"style-seg-btn" + (v === value ? " on" : "")}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit = t("% 畫面高"),
  digits,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
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
        {value.toFixed(digits ?? (step < 0.1 ? 2 : 1))}
        <span className="style-unit">{unit}</span>
      </span>
    </label>
  );
}
