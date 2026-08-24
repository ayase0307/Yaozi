/**
 * 翻譯表的自我檢查。跑法:`npm run selfcheck`(Node 24 直接吃 TS)。
 * 抓的是最容易發生又最難用眼睛看出來的兩件事:
 *   1. 程式碼裡 t("…") 的 key 在 en / ja 少了一條(那句會退回中文)
 *   2. 翻譯句子裡的 {0}、{1} 跟原文對不上(參數會漏掉或印出 undefined)
 */
import { readFileSync, readdirSync } from "node:fs";
import en from "./locales/en.ts";
import ja from "./locales/ja.ts";

const SRC = new URL(".", import.meta.url);
const SKIP = new Set(["i18n.ts", "segments.selfcheck.ts", "i18n.selfcheck.ts"]);
const CALL = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;

const keys = new Set<string>();
for (const name of readdirSync(SRC)) {
  if (!/\.tsx?$/.test(name) || SKIP.has(name)) continue;
  const text = readFileSync(new URL(name, SRC), "utf8");
  for (const m of text.matchAll(CALL)) keys.add(m[1].replace(/\\"/g, '"'));
}

const holes = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(",");

const problems: string[] = [];
for (const [name, table] of [["en", en], ["ja", ja]] as const) {
  for (const key of keys) {
    if (!(key in table)) problems.push(`${name} 少了: ${key}`);
    else if (holes(table[key]) !== holes(key)) problems.push(`${name} 參數對不上: ${key}`);
  }
  for (const key of Object.keys(table)) {
    if (!keys.has(key)) problems.push(`${name} 多餘(程式碼已經沒用到): ${key}`);
  }
}

if (problems.length) throw new Error(`i18n selfcheck 失敗:\n  ${problems.join("\n  ")}`);
console.log(`i18n selfcheck ok (${keys.size} keys × 2 langs)`);
