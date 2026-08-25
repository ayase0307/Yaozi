import AudioControls from "./AudioControls";
import type { AudioSettings } from "./types";
import { t } from "./i18n";

/** 編輯器側邊的音訊處理面板。內容跟原本設定頁同一個元件、同一組全域設定,
 *  匯出成品影片與「處理後音訊(MP3)」用的就是這一份。 */
export default function AudioPanel({
  value,
  onChange,
  onClose,
}: {
  value: AudioSettings;
  onChange: (s: AudioSettings) => void;
  onClose: () => void;
}) {
  return (
    <div className="fix-panel" role="dialog" aria-label={t("音訊處理")}>
      <div className="fix-head">
        <span className="fix-title">{t("音訊處理")}</span>
        <span className="toolbar-spacer" />
        <button className="btn small" onClick={onClose}>
          {t("關閉")}
        </button>
      </div>
      <p className="settings-sub">{t("套用在匯出的成品影片與「下載處理後音訊」上。原始檔不會被改動。")}</p>
      <AudioControls value={value} onChange={onChange} />
    </div>
  );
}
