import { useEffect, useState } from "react";
import { api } from "./api";

/** 介面字型(不是字幕字型)。存 localStorage,純前端的事,不用經過後端。 */

const KEY = "vidscribe:uifont";

/** 空字串 = 用 styles.css 裡的系統預設堆疊。 */
export function applyUiFont(font: string): void {
  document.documentElement.style.setProperty(
    "--sans",
    font ? `"${font}", var(--sans-fallback)` : "var(--sans-fallback)"
  );
}

export function loadUiFont(): string {
  return localStorage.getItem(KEY) ?? "";
}

export default function UiFontPicker() {
  const [font, setFont] = useState(loadUiFont);
  const [families, setFamilies] = useState<string[]>([]);

  useEffect(() => {
    api
      .getFonts()
      .then((f) => setFamilies(f.families))
      .catch(() => {});
  }, []);

  const pick = (value: string) => {
    setFont(value);
    localStorage.setItem(KEY, value);
    applyUiFont(value);
  };

  return (
    <label className="uifont">
      <span className="uifont-label">介面字型</span>
      <select
        className="select"
        value={families.includes(font) ? font : ""}
        onChange={(e) => pick(e.target.value)}
      >
        <option value="">系統預設</option>
        {families.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </label>
  );
}
