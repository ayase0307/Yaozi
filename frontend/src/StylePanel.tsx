import StyleControls from "./StyleControls";
import type { SubtitleStyle } from "./types";
import { t } from "./i18n";

/** 編輯器側邊的字幕外觀面板。內容跟設定頁是同一個元件、同一組全域設定。 */
export default function StylePanel({
  value,
  onChange,
  onClose,
}: {
  value: SubtitleStyle;
  onChange: (s: SubtitleStyle) => void;
  onClose: () => void;
}) {
  return (
    <div className="fix-panel" role="dialog" aria-label={t("字幕外觀")}>
      <div className="fix-head">
        <span className="fix-title">{t("字幕外觀")}</span>
        <span className="toolbar-spacer" />
        {/* 「聽成什麼」在設定頁、「長什麼樣」在這裡,兩邊常常要一起調,給個直達的入口 */}
        <a className="btn small" href="#/settings" title={t("語言、提示詞、單句上限")}>
          {t("辨識設定")}
        </a>
        <button className="btn small" onClick={onClose}>
          {t("關閉")}
        </button>
      </div>
      <StyleControls value={value} onChange={onChange} />
    </div>
  );
}
