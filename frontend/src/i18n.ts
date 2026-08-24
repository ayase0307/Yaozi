/** 介面語言。翻譯表的 key 就是繁體中文原句(gettext 那一套),
 *  查不到就原樣顯示——所以少翻一句只是那一句維持中文,不會變成空白或亂碼。
 *
 *  切換語言直接重新整理頁面:語言只在載入時讀一次,不必把 context 穿過整棵元件樹。 */

import en from "./locales/en.ts";
import ja from "./locales/ja.ts";

export type Lang = "zh-TW" | "en" | "ja";

export const LANG_NAMES: Record<Lang, string> = {
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
};

const KEY = "yaozi:lang";
const TABLES: Record<Lang, Record<string, string>> = { "zh-TW": {}, en, ja };

// selfcheck 在 Node 底下 import 得到這支,那裡沒有 navigator/localStorage/document
const browser = typeof document !== "undefined";

function detect(): Lang {
  const nav = browser ? navigator.language.toLowerCase() : "zh";
  if (nav.startsWith("zh")) return "zh-TW";
  if (nav.startsWith("ja")) return "ja";
  return "en";
}

function stored(): Lang | null {
  const v = browser ? localStorage.getItem(KEY) : null;
  return v === "zh-TW" || v === "en" || v === "ja" ? v : null;
}

export const lang: Lang = stored() ?? detect();

const table = TABLES[lang];

if (browser) document.documentElement.lang = lang;

/** 後端訊息常是「說明:細節」這種形式,細節是檔名、ffmpeg 輸出之類的動態內容,
 *  整句對不上翻譯表。ponytail: 只翻冒號前面那半段,細節原樣附回去。 */
function translatePrefix(zh: string): string {
  const m = zh.match(/^(.+?)([::])([\s\S]+)$/);
  const head = m && table[m[1]];
  return head ? head + m[2] + m[3] : zh;
}

/** t("已取代 {0} 處") / t("已取代 {0} 處", n)。 */
export function t(zh: string, ...args: (string | number)[]): string {
  const s = table[zh] ?? translatePrefix(zh);
  if (!args.length) return s;
  return s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ""));
}

export function setLang(next: Lang): void {
  localStorage.setItem(KEY, next);
  location.reload();
}
