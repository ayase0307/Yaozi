/** 介面字級。跟介面字型是一組的:點陣字型(俐方體11號)在 11 的倍數才銳利,
 *  所以得讓使用者自己把整個介面放大到 22。 */

const KEY = "vidscribe:uisize";
const DEFAULT = 15;

export function loadUiSize(): number {
  const n = Number(localStorage.getItem(KEY));
  return n >= 12 && n <= 24 ? n : DEFAULT;
}

export function applyUiSize(px: number, persist = false): void {
  document.documentElement.style.setProperty("--ui-size", `${px}px`);
  if (persist) localStorage.setItem(KEY, String(px));
}
