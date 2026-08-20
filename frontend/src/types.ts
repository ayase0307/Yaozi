export interface Word {
  start: number;
  end: number;
  word: string;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: Word[];
  /** 譯文。有值才算雙語字幕,燒錄與雙語 SRT 會多印一行。 */
  trans?: string;
}

export interface Project {
  id: string;
  name: string;
  created_at: number;
  media_file: string;
  status:
    | "downloading"
    | "uploaded"
    | "extracting"
    | "loading_model"
    | "transcribing"
    | "converting"
    | "done"
    | "error"
    | "interrupted";
  progress: number;
  error: string | null;
  duration: number | null;
  language: string | null;
  has_video: boolean | null;
  model: string;
  device: string | null;
  /** 剪輯範圍(秒)。null = 整支影片。燒錄與匯出字幕都只出這一段。 */
  trim: { start: number; end: number } | null;
}

/** 字幕外觀。size / outline / bottom 都是「佔畫面高度的百分比」,換解析度不用重設。 */
export interface SubtitleStyle {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  spacing: number;
  color: string;
  border: "outline" | "box" | "none";
  outline: number;
  outline_color: string;
  outline_opacity: number;
  shadow: number;
  shadow_color: string;
  shadow_opacity: number;
  align: "left" | "center" | "right";
  vertical: "top" | "bottom";
  bottom: number;
  side: number;
  max_chars: number;
  /** 譯文專用。font 留空、size 給 0 都代表沿用原文;gap 是兩行之間的距離。 */
  trans_font: string;
  trans_size: number;
  trans_color: string;
  trans_bold: boolean;
  trans_italic: boolean;
  trans_gap: number;
}

/** 辨識設定(全域)。language 是 Whisper 語言代碼,"auto" 為自動偵測。 */
export interface AsrSettings {
  language: string;
  prompt: string;
  vad: boolean;
  vad_threshold: number;
  /** 一句超過幾個字就照單字時間戳自動切開;0 = 不切。 */
  split_chars: number;
}

/** 依語系分好的字型清單,後端排好順序(中文在最前面)。 */
export interface FontGroup {
  label: string;
  fonts: string[];
}

export interface DictEntry {
  id: string;
  wrong: string;
  right: string;
}

export interface FixSuggestion {
  id: string;
  old: string;
  new: string;
}

export interface FixJob {
  status: "idle" | "running" | "done" | "error" | "canceled";
  total?: number;
  done?: number;
  suggestions?: FixSuggestion[];
  error?: string | null;
  started_at?: number;
}

export interface TranslateJob {
  status: "idle" | "running" | "done" | "error" | "canceled";
  total?: number;
  done?: number;
  target?: string;
  error?: string | null;
  started_at?: number;
}

export interface BurnJob {
  status: "idle" | "running" | "done" | "error" | "canceled";
  progress: number;
  error: string | null;
  has_file: boolean;
}

export const RUNNING_STATUSES: Project["status"][] = [
  "downloading",
  "uploaded",
  "extracting",
  "loading_model",
  "transcribing",
  "converting",
];

export function statusLabel(p: Project): string {
  switch (p.status) {
    case "downloading":
      return "下載影片中";
    case "uploaded":
      return "等待辨識";
    case "extracting":
      return "抽取音軌中";
    case "loading_model":
      return "載入模型中(首次會下載,需要幾分鐘)";
    case "transcribing":
      return `辨識中 ${Math.round(p.progress * 100)}%`;
    case "converting":
      return "轉換繁體中";
    case "done":
      return "完成";
    case "error":
      return "辨識失敗";
    case "interrupted":
      return "辨識中斷";
  }
}
