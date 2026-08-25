import { useEffect, useRef } from "react";
import { api } from "./api";
import Hint from "./Hint";
import type { AudioSettings } from "./types";
import { t } from "./i18n";

/** 音訊處理。每一項都是一段 ffmpeg 濾鏡,順序由後端固定
 *  (去噪 → 人聲頻段 → 響度 → 增益),這裡只負責開關與強度。 */
export default function AudioControls({
  value,
  onChange,
}: {
  value: AudioSettings;
  onChange: (s: AudioSettings) => void;
}) {
  const timer = useRef<number | undefined>(undefined);

  const update = (patch: Partial<AudioSettings>) => {
    const next = { ...value, ...patch };
    onChange(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => api.saveAudio(next).catch(() => {}), 400);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className="style-body">
      <div className="style-row">
        <span className="style-label">{t("降噪")}</span>
        <label className="style-check">
          <input
            type="checkbox"
            checked={value.denoise}
            onChange={(e) => update({ denoise: e.target.checked })}
          />
          {t("壓掉冷氣、風扇那種持續底噪")}
        </label>
      </div>
      {value.denoise && (
        <label className="style-row">
          <span className="style-label">{t("降噪強度")}</span>
          <input
            type="range"
            className="style-range"
            min={1}
            max={60}
            step={1}
            value={value.denoise_db}
            onChange={(e) => update({ denoise_db: Number(e.target.value) })}
          />
          <span className="style-value mono">
            {value.denoise_db}
            <span className="style-unit">dB</span>
          </span>
        </label>
      )}
      <Hint>{t("調太大人聲會變悶、出現水聲般的殘響,先從 12 dB 附近試。")}</Hint>

      <div className="style-row">
        <span className="style-label">{t("人聲頻段")}</span>
        <label className="style-check">
          <input
            type="checkbox"
            checked={value.voice}
            onChange={(e) => update({ voice: e.target.checked })}
          />
          {t("只留 80Hz~8kHz,砍掉低頻隆隆聲與嘶聲")}
        </label>
      </div>

      <div className="style-row">
        <span className="style-label">{t("響度標準化")}</span>
        <label className="style-check">
          <input
            type="checkbox"
            checked={value.normalize}
            onChange={(e) => update({ normalize: e.target.checked })}
          />
          {t("整支拉到同一個響度(EBU R128)")}
        </label>
      </div>
      {value.normalize && (
        <label className="style-row">
          <span className="style-label">{t("目標響度")}</span>
          <input
            type="range"
            className="style-range"
            min={-30}
            max={-8}
            step={1}
            value={value.target_lufs}
            onChange={(e) => update({ target_lufs: Number(e.target.value) })}
          />
          <span className="style-value mono">
            {value.target_lufs}
            <span className="style-unit">LUFS</span>
          </span>
        </label>
      )}
      <Hint>{t("-16 LUFS 是串流平台常見值,想再響一點就往 -14 調。")}</Hint>

      <label className="style-row">
        <span className="style-label">{t("音量增益")}</span>
        <input
          type="range"
          className="style-range"
          min={-20}
          max={20}
          step={1}
          value={value.gain_db}
          onChange={(e) => update({ gain_db: Number(e.target.value) })}
        />
        <span className="style-value mono">
          {value.gain_db > 0 ? "+" : ""}
          {value.gain_db}
          <span className="style-unit">dB</span>
        </span>
      </label>
      <Hint>{t("單純想大聲一點用這個。開了響度標準化的話,通常留 0 就好。")}</Hint>

      <div className="style-row">
        <span className="style-label">{t("辨識前處理")}</span>
        <label className="style-check">
          <input
            type="checkbox"
            checked={value.pre_asr}
            onChange={(e) => update({ pre_asr: e.target.checked })}
          />
          {t("辨識前先套一次上面的處理")}
        </label>
      </div>
      <Hint>
        {t("只在收音很糟(風聲、電流聲蓋過人聲)時才建議打開;乾淨的素材處理過反而更容易聽錯。改完要按「重新辨識」才會生效。")}
      </Hint>
    </div>
  );
}
