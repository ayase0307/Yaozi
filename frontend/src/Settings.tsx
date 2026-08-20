import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import Brand from "./Brand";
import FontPicker from "./FontPicker";
import StyleControls from "./StyleControls";
import { applyUiSize, loadUiSize } from "./UiSize";
import { loadUiFont, saveUiFont } from "./UiFont";
import type { AsrSettings, SubtitleStyle } from "./types";

/** 設定頁。放的是「跨專案的全域設定」——介面長相、字幕外觀、環境檢查;
 *  只跟單一專案有關的東西(安全框、詞庫套用)留在編輯器裡。 */
export default function Settings() {
  const [uiFont, setUiFont] = useState(loadUiFont);
  const [uiSize, setUiSize] = useState(loadUiSize);
  const [style, setStyle] = useState<SubtitleStyle | null>(null);
  const [asr, setAsr] = useState<AsrSettings | null>(null);
  const [health, setHealth] = useState<{ ffmpeg: boolean; claude: boolean } | null>(null);

  useEffect(() => {
    api.getStyle().then(setStyle).catch(() => {});
    api.getAsr().then(setAsr).catch(() => {});
    api.getHealth().then(setHealth).catch(() => {});
  }, []);

  const pickFont = (f: string) => {
    setUiFont(f);
    saveUiFont(f);
  };

  const pickSize = (n: number) => {
    setUiSize(n);
    applyUiSize(n, true);
  };

  return (
    <div className="page">
      <header className="topbar">
        <a className="brand-link" href="#/">
          <Brand />
        </a>
        <span className="topbar-name">設定</span>
        <span className="topbar-right">
          <a className="btn small" href="#/">
            回首頁
          </a>
        </span>
      </header>

      <main className="settings">
        <section className="settings-card">
          <h2 className="settings-title">介面</h2>
          <div className="style-body">
            <div className="style-row">
              <span className="style-label">介面字型</span>
              <FontPicker value={uiFont} onChange={pickFont} placeholder="系統預設" />
            </div>
            <label className="style-row">
              <span className="style-label">介面字級</span>
              <input
                type="range"
                className="style-range"
                min={12}
                max={24}
                step={1}
                value={uiSize}
                onChange={(e) => pickSize(Number(e.target.value))}
              />
              <span className="style-value mono">
                {uiSize}
                <span className="style-unit">px</span>
              </span>
            </label>
            <p className="style-hint">
              預設是俐方體11號(點陣字型),字級設成 11 的倍數——11、22——筆畫最銳利,
              其他大小會有點糊。不合胃口就換成系統預設。
            </p>
          </div>
        </section>

        <section className="settings-card">
          <h2 className="settings-title">辨識</h2>
          <p className="settings-sub">
            改完之後,在專案裡按「重新辨識」才會套用到既有字幕。
          </p>
          {asr ? <AsrControls value={asr} onChange={setAsr} /> : <p className="hint">載入中…</p>}
        </section>

        <section className="settings-card">
          <h2 className="settings-title">字幕外觀</h2>
          <p className="settings-sub">
            這是全域設定,所有專案共用,燒錄成品用的就是這一組。
          </p>
          {style ? (
            <StyleControls value={style} onChange={setStyle} />
          ) : (
            <p className="hint">載入中…</p>
          )}
        </section>

        <section className="settings-card">
          <h2 className="settings-title">環境</h2>
          <div className="settings-checks">
            <Check ok={health?.ffmpeg} label="ffmpeg" note="沒有就無法辨識與匯出,跑 setup.bat 安裝" />
            <Check
              ok={health?.claude}
              label="Claude Code CLI"
              note="沒有就只是少了 AI 校正,其他功能照常"
            />
          </div>
        </section>
      </main>
    </div>
  );
}

// 常用語言排前面,其他的照 Whisper 語言代碼直接列。"auto" 是預設。
const LANGS: [string, string][] = [
  ["auto", "自動偵測"],
  ["zh", "中文"],
  ["ja", "日文"],
  ["en", "英文"],
  ["ko", "韓文"],
  ["yue", "粵語"],
  ["th", "泰文"],
  ["vi", "越南文"],
  ["id", "印尼文"],
  ["es", "西班牙文"],
  ["fr", "法文"],
  ["de", "德文"],
];

/** 辨識設定。這幾個值決定 Whisper 聽到什麼,調錯的話字幕會整段是幻覺。 */
function AsrControls({
  value,
  onChange,
}: {
  value: AsrSettings;
  onChange: (s: AsrSettings) => void;
}) {
  const timer = useRef<number | undefined>(undefined);

  const update = (patch: Partial<AsrSettings>) => {
    const next = { ...value, ...patch };
    onChange(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => api.saveAsr(next).catch(() => {}), 400);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className="style-body">
      <label className="style-row">
        <span className="style-label">語言</span>
        <select
          className="select"
          value={value.language}
          onChange={(e) => update({ language: e.target.value })}
        >
          {LANGS.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="style-hint">
        鎖成單一語言會準一點,但丟進來的影片如果不是那個語言,Whisper 會硬把聽到的東西
        當成該語言,整段變成掰出來的句子。不確定就留自動偵測。
      </p>

      <div className="style-row style-row-stack">
        <span className="style-label">提示詞</span>
        <textarea
          className="asr-prompt"
          rows={2}
          value={value.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder="人名、專有名詞、歌詞片段…例:防治所、結核病、卡介苗"
        />
      </div>
      <p className="style-hint">
        先給模型看過的一段文字,難字會聽得比較準。跟詞庫的差別:提示詞影響「聽成什麼」,
        詞庫是聽完之後才做取代。
      </p>

      <div className="style-row">
        <span className="style-label">靜音過濾</span>
        <label className="style-check">
          <input
            type="checkbox"
            checked={value.vad}
            onChange={(e) => update({ vad: e.target.checked })}
          />
          跳過沒有人聲的片段
        </label>
      </div>
      {value.vad && (
        <label className="style-row">
          <span className="style-label">靈敏度</span>
          <input
            type="range"
            className="style-range"
            min={0.1}
            max={0.9}
            step={0.05}
            value={value.vad_threshold}
            onChange={(e) => update({ vad_threshold: Number(e.target.value) })}
          />
          <span className="style-value mono">{value.vad_threshold.toFixed(2)}</span>
        </label>
      )}
      <p className="style-hint">
        數字調低會抓到更多小聲、唱歌的段落(也更容易把雜訊當人聲);調高則相反。
        整支影片只辨識出零星幾句時,先把這個往下調。
      </p>
    </div>
  );
}

function Check({ ok, label, note }: { ok?: boolean; label: string; note: string }) {
  return (
    <div className="settings-check">
      <span className={"settings-dot" + (ok ? " on" : ok === false ? " off" : "")} aria-hidden />
      <span className="settings-check-name">{label}</span>
      <span className="settings-check-note">{ok === undefined ? "檢查中…" : note}</span>
    </div>
  );
}
