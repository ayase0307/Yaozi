import StyleControls from "./StyleControls";
import type { SubtitleStyle } from "./types";

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
    <div className="fix-panel" role="dialog" aria-label="字幕外觀">
      <div className="fix-head">
        <span className="fix-title">字幕外觀</span>
        <span className="toolbar-spacer" />
        <button className="btn small" onClick={onClose}>
          關閉
        </button>
      </div>
      <StyleControls value={value} onChange={onChange} />
    </div>
  );
}
