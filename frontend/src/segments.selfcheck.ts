/**
 * 字幕邏輯的自我檢查。跑法:`npm run selfcheck`(Node 24 直接吃 TS)。
 * 只測會算錯又看不出來的那幾條:合併的接縫、閱讀速度、問題判定。
 */
import {
  mergeSegments,
  parseSrt,
  readingSpeed,
  segmentProblem,
  segmentProblemInfo,
  textWidth,
} from "./segments.ts";
import type { Segment } from "./types.ts";

// 自己寫兩行,免得為了跑一個檢查去裝 @types/node
const assert = {
  ok(v: unknown, msg = "") {
    if (!v) throw new Error(`assert 失敗: ${msg}`);
  },
  equal(got: unknown, want: unknown) {
    if (got !== want) throw new Error(`assert 失敗: 得到 ${String(got)},預期 ${String(want)}`);
  },
};

const seg = (start: number, end: number, text: string, trans?: string): Segment => ({
  id: Math.random().toString(36).slice(2),
  start,
  end,
  text,
  trans,
});

// 字寬:全形 2、半形 1、空白不算
assert.equal(textWidth("你好"), 4);
assert.equal(textWidth("hello world"), 10);
assert.equal(textWidth("AI 圈"), 4);

// 中文 9 字/秒 與 英文 17 字元/秒 都該落在同一個門檻附近
assert.ok(Math.abs(readingSpeed(seg(0, 1, "一二三四五六七八九")) - 18) < 0.1);
assert.ok(Math.abs(readingSpeed(seg(0, 1, "abcdefghijklmnopq")) - 17) < 0.1);

// 合併:英文接縫要補空白,中文不補
assert.equal(mergeSegments(seg(0, 1, "hello"), seg(1, 2, "world")).text, "hello world");
assert.equal(mergeSegments(seg(0, 1, "你好"), seg(1, 2, "世界")).text, "你好世界");
assert.equal(mergeSegments(seg(0, 1, "結束。"), seg(1, 2, "開始")).text, "結束。開始");
// 譯文:兩邊都沒有就維持 undefined(有值才算雙語字幕)
assert.equal(mergeSegments(seg(0, 1, "a"), seg(1, 2, "b")).trans, undefined);
assert.equal(mergeSegments(seg(0, 1, "a", "甲"), seg(1, 2, "b", "乙")).trans, "甲 乙");
assert.equal(mergeSegments(seg(0, 1, "a", "甲"), seg(1, 2, "b")).trans, "甲");

// 問題判定
const list = [seg(0, 2, "正常的一句話"), seg(1.5, 3, "重疊"), seg(3, 5, "  ")];
assert.equal(segmentProblem(list, 0), "");
assert.ok(segmentProblem(list, 1).includes("重疊"));
assert.equal(segmentProblemInfo(list, 1)?.kind, "overlap");
assert.ok(segmentProblem(list, 2).includes("空"));
assert.ok(segmentProblem([seg(0, 1, "一二三四五六七八九十")], 0).includes("快"));
// 唱歌拉長音:字少秒數長,不該被當成問題
assert.equal(segmentProblem([seg(0, 10.9, "好きなものを持ちつつ")], 0), "");

// SRT 匯入:逗號毫秒、VTT 的點毫秒、多行內文、缺毫秒位數都要吃得下
const srt = parseSrt(
  "WEBVTT\n\n1\n00:00:01,000 --> 00:00:02,500\n第一句\n\n" +
    "2\n00:00:02.500 --> 00:01:00.08\n第二句上半\n第二句下半\n\n" +
    "3\n00:00:05,000 --> 00:00:05,000\n時間反了的不要\n"
);
assert.equal(srt.length, 2);
assert.equal(srt[0].start, 1);
assert.equal(srt[0].end, 2.5);
assert.equal(srt[1].text, "第二句上半 第二句下半");
assert.equal(srt[1].end, 60.08);
assert.equal(parseSrt("這不是字幕檔").length, 0);

console.log("segments selfcheck ok");
