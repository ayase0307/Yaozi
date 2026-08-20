import { useEffect, useState } from "react";
import { api } from "./api";
import Brand from "./Brand";
import FontPicker from "./FontPicker";
import StyleControls from "./StyleControls";
import { applyUiSize, loadUiSize } from "./UiSize";
import { loadUiFont, saveUiFont } from "./UiFont";
import type { SubtitleStyle } from "./types";

/** 設定頁。放的是「跨專案的全域設定」——介面長相、字幕外觀、環境檢查;
 *  只跟單一專案有關的東西(安全框、詞庫套用)留在編輯器裡。 */
export default function Settings() {
  const [uiFont, setUiFont] = useState(loadUiFont);
  const [uiSize, setUiSize] = useState(loadUiSize);
  const [style, setStyle] = useState<SubtitleStyle | null>(null);
  const [health, setHealth] = useState<{ ffmpeg: boolean; claude: boolean } | null>(null);

  useEffect(() => {
    api.getStyle().then(setStyle).catch(() => {});
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

function Check({ ok, label, note }: { ok?: boolean; label: string; note: string }) {
  return (
    <div className="settings-check">
      <span className={"settings-dot" + (ok ? " on" : ok === false ? " off" : "")} aria-hidden />
      <span className="settings-check-name">{label}</span>
      <span className="settings-check-note">{ok === undefined ? "檢查中…" : note}</span>
    </div>
  );
}
