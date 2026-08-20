/** 介面字型(不是字幕字型)。存 localStorage,純前端的事,不用經過後端。 */

import { fontStack } from "./FontPicker";

const KEY = "yaozi:uifont";

/** 沒設定過就用俐方體11號——點陣字,11 的倍數(11/22/33px)最銳利。
 *  字型檔跟著 repo 走(frontend/public/fonts/Cubic_11.ttf,@font-face 寫在 styles.css),
 *  不管系統有沒有裝都一定套得上。 */
export const DEFAULT_UI_FONT = "俐方體11號";

/** 空字串 = 用 styles.css 裡的系統預設堆疊。
 *
 *  字型清單還沒回來時 fontStack() 只吐得出本地化名稱,清單一到 App 會再套一次
 *  把英文名補上去——不然 Chrome 認不得的那些字型會默默掉回系統字。 */
export function applyUiFont(font: string): void {
  document.documentElement.style.setProperty(
    "--sans",
    font ? `${fontStack(font)}, var(--sans-fallback)` : "var(--sans-fallback)"
  );
}

export function loadUiFont(): string {
  return localStorage.getItem(KEY) ?? DEFAULT_UI_FONT;
}

export function saveUiFont(font: string): void {
  localStorage.setItem(KEY, font);
  applyUiFont(font);
}
