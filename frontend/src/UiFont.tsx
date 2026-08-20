/** 介面字型(不是字幕字型)。存 localStorage,純前端的事,不用經過後端。 */

const KEY = "vidscribe:uifont";

/** 沒設定過就用俐方體11號——點陣字,11 的倍數(11/22/33px)最銳利。沒裝也不會壞,
 *  瀏覽器會自動掉到 --sans-fallback。 */
export const DEFAULT_UI_FONT = "俐方體11號";

/** 空字串 = 用 styles.css 裡的系統預設堆疊。 */
export function applyUiFont(font: string): void {
  document.documentElement.style.setProperty(
    "--sans",
    font ? `"${font}", var(--sans-fallback)` : "var(--sans-fallback)"
  );
}

export function loadUiFont(): string {
  return localStorage.getItem(KEY) ?? DEFAULT_UI_FONT;
}

export function saveUiFont(font: string): void {
  localStorage.setItem(KEY, font);
  applyUiFont(font);
}
