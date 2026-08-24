import type { Segment } from "./types";
import { t } from "./i18n.ts";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function formatTime(t: number): string {
  const total = Math.max(0, t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sec = s.toFixed(1).padStart(4, "0");
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${sec}`
    : `${String(m).padStart(2, "0")}:${sec}`;
}

/** 完整毫秒格式:1:45.405,給工具列與資訊列用。 */
export function formatTimeMs(t: number): string {
  const total = Math.max(0, t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const base = `${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  return h > 0 ? `${h}:${base}` : base;
}

const round3 = (t: number) => Math.round(t * 1000) / 1000;

/** 解析 SRT / VTT 的時間軸與文字。序號、WEBVTT 標頭、cue 設定都直接忽略,
 *  只認「時間 --> 時間」那一行,底下到空行為止都算內文(多行折成一行)。
 *  解析不出任何一句就回空陣列,呼叫端負責提示。 */
export function parseSrt(text: string): Segment[] {
  const time = /(\d+):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/;
  const secs = (h: string, m: string, s: string, ms: string) =>
    round3(Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000);

  const out: Segment[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = time.exec(lines[i]);
    if (!m) continue;
    const body: string[] = [];
    while (++i < lines.length && lines[i].trim() !== "") body.push(lines[i].trim());
    const start = secs(m[1], m[2], m[3], m[4]);
    const end = secs(m[5], m[6], m[7], m[8]);
    if (end <= start || !body.length) continue;
    out.push({ id: uid(), start, end, text: body.join(" ") });
  }
  return out;
}

// 全形字的 Unicode 區段(CJK、假名、韓文、全形標點),跟後端 transcriber._width() 同一套。
// 直接抄 East_Asian_Width 的 W/F 主要區塊,不必為了幾個冷門字去搬整張表。
const WIDE = new RegExp(
  "[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF" +
    "\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F" +
    "\uFF00-\uFF60\uFFE0-\uFFE6]"
);

/** 字寬:全形算 2、半形算 1,空白不算。 */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    w += WIDE.test(ch) ? 2 : 1;
  }
  return w;
}

/**
 * 閱讀速度,單位是「字寬/秒」。
 * Netflix 的上限中文是 9 字/秒、英文 17 字元/秒——換成字寬剛好都是 ~18,
 * 所以一個門檻兩種語言都適用,不必先判斷這句是什麼語言。
 */
export const SPEED_WARN = 18;
export const SPEED_OVER = 24;

export function readingSpeed(seg: Segment): number {
  return textWidth(seg.text) / Math.max(seg.end - seg.start, 0.01);
}

/** "" / "warn"(偏快) / "over"(來不及看) */
export function speedLevel(seg: Segment): "" | "warn" | "over" {
  const v = readingSpeed(seg);
  return v > SPEED_OVER ? "over" : v > SPEED_WARN ? "warn" : "";
}

/** 一句最多兩行、每行 24 個全形字 —— 超過就是燒出來會擠成一坨的那種。 */
const MAX_WIDTH = 48;

/**
 * 這一句有沒有毛病?有的話回傳一句話說明,沒有回傳 ""。
 * 「跳到下一個問題」跟校對清單都讀這裡,標準只有一份。
 */
export function segmentProblem(segments: Segment[], i: number): string {
  const seg = segments[i];
  if (!seg) return "";
  if (!seg.text.trim()) return t("這句是空的");
  if (i > 0 && seg.start < segments[i - 1].end - 0.001) return t("跟前一句時間重疊");
  if (seg.end - seg.start < 0.4) return t("停留不到 0.4 秒,幾乎看不到");
  const level = speedLevel(seg);
  if (level) return level === "over" ? t("太快了,來不及看完") : t("偏快");
  if (textWidth(seg.text) > MAX_WIDTH) return t("太長,一屏塞不下");
  return "";
}

/**
 * 在文字的 pos 位置把一句切成兩句。
 * 切點時間先按字數比例推估,再磁吸到 0.3 秒內最近的單字邊界。
 */
export function splitSegment(seg: Segment, pos: number): [Segment, Segment] | null {
  const text1 = seg.text.slice(0, pos).trim();
  const text2 = seg.text.slice(pos).trim();
  if (!text1 || !text2) return null;

  const ratio = pos / seg.text.length;
  let t = seg.start + (seg.end - seg.start) * ratio;
  const words = seg.words ?? [];
  if (words.length > 1) {
    let best: number | null = null;
    let bestDist = 0.3;
    for (let i = 1; i < words.length; i++) {
      const dist = Math.abs(words[i].start - t);
      if (dist < bestDist) {
        bestDist = dist;
        best = words[i].start;
      }
    }
    if (best !== null) t = best;
  }
  t = round3(Math.min(Math.max(t, seg.start + 0.05), seg.end - 0.05));

  const first: Segment = {
    ...seg,
    end: t,
    text: text1,
    words: words.filter((w) => (w.start + w.end) / 2 < t),
  };
  const second: Segment = {
    id: uid(),
    start: t,
    end: seg.end,
    text: text2,
    words: words.filter((w) => (w.start + w.end) / 2 >= t),
  };
  return [first, second];
}

/**
 * 在時間 t 把一句切成兩句(波形區 B 鍵用)。
 * 文字切點先用單字時間戳找,找不到就按時間比例推。
 */
export function splitSegmentAtTime(seg: Segment, t: number): [Segment, Segment] | null {
  if (t <= seg.start + 0.05 || t >= seg.end - 0.05) return null;
  const words = seg.words ?? [];
  let pos = -1;
  if (words.length > 1) {
    // 在實際文字裡逐一定位每個單字(單字常帶空白、文字又被 trim 過,
    // 不能直接累加長度),找到第一個在切點之後開口的字,取它的位置
    let searchFrom = 0;
    for (const w of words) {
      const token = w.word.trim();
      if (!token) continue;
      const idx = seg.text.indexOf(token, searchFrom);
      if (idx < 0) {
        pos = -1; // 文字被改過對不上,退回時間比例法
        break;
      }
      if (w.start >= t) {
        pos = idx;
        break;
      }
      searchFrom = idx + token.length;
    }
  }
  if (pos <= 0 || pos >= seg.text.length) {
    pos = Math.round((seg.text.length * (t - seg.start)) / (seg.end - seg.start));
  }
  pos = Math.min(Math.max(pos, 1), seg.text.length - 1);
  const text1 = seg.text.slice(0, pos).trim();
  const text2 = seg.text.slice(pos).trim();
  if (!text1 || !text2) return null;
  const cut = round3(t);
  return [
    { ...seg, end: cut, text: text1, words: words.filter((w) => (w.start + w.end) / 2 < cut) },
    {
      id: uid(),
      start: cut,
      end: seg.end,
      text: text2,
      words: words.filter((w) => (w.start + w.end) / 2 >= cut),
    },
  ];
}

/** 把 b 併進 a(a 在前)。接縫兩邊都是英數字時要補一個空白,不然會黏成 wordword。 */
export function mergeSegments(a: Segment, b: Segment): Segment {
  const glue = /[A-Za-z0-9]$/.test(a.text) && /^[A-Za-z0-9]/.test(b.text) ? " " : "";
  return {
    ...a,
    end: b.end,
    text: a.text + glue + b.text,
    trans: a.trans === undefined && b.trans === undefined
      ? undefined
      : (a.trans ?? "") + (b.trans ? (a.trans ? " " : "") + b.trans : ""),
    words: [...(a.words ?? []), ...(b.words ?? [])],
  };
}

/** 目前播放時間落在哪一句(先找包含的,否則找最近開始過的)。 */
export function activeIndexAt(segments: Segment[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= t) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate >= 0 && t < segments[candidate].end) return candidate;
  return -1;
}
