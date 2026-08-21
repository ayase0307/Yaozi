import type {
  AsrSettings,
  AiProvider,
  AiStatus,
  BurnJob,
  DictEntry,
  FixJob,
  FontGroup,
  Project,
  Segment,
  SubtitleStyle,
  TranslateJob,
} from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  getHealth: () =>
    fetch("/api/health").then((r) =>
      json<{ ffmpeg: boolean; claude: boolean; codex: boolean; ai_provider: AiProvider }>(r)
    ),

  listProjects: () => fetch("/api/projects").then((r) => json<Project[]>(r)),

  createFromUrl: (url: string) =>
    fetch("/api/projects/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then((r) => json<Project>(r)),

  getProject: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<Project>(r)),

  /** 改專案名或剪輯範圍;只送要改的欄位。 */
  patchProject: (id: string, patch: { name?: string; trim?: Project["trim"] }) =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<Project>(r)),

  deleteProject: (id: string) =>
    fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),

  retranscribe: (id: string) =>
    fetch(`/api/projects/${id}/transcribe`, { method: "POST" }).then((r) => json<Project>(r)),

  getSubtitles: (id: string) =>
    fetch(`/api/projects/${id}/subtitles`).then((r) =>
      json<{ version: number; segments: Segment[]; marks?: number[] }>(r)
    ),

  saveSubtitles: (id: string, segments: Segment[], marks: number[]) =>
    fetch(`/api/projects/${id}/subtitles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments, marks }),
    }).then((r) => json<{ ok: boolean }>(r)),

  // splitChars 不給就用設定頁存的那個值;設定頁的即時預覽要用還沒存的值,所以要能覆寫
  resegment: (segments: Segment[], splitChars?: number) =>
    fetch("/api/resegment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments, split_chars: splitChars }),
    }).then((r) => json<{ segments: Segment[] }>(r)),

  getCuts: (id: string) =>
    fetch(`/api/projects/${id}/cuts`).then((r) =>
      json<{ status: string; cuts: number[]; error: string | null }>(r)
    ),

  startCuts: (id: string) =>
    fetch(`/api/projects/${id}/cuts`, { method: "POST" }).then((r) =>
      json<{ status: string; cuts: number[]; error: string | null }>(r)
    ),

  getDictionary: () =>
    fetch("/api/dictionary").then((r) => json<{ entries: DictEntry[] }>(r)),

  addDictEntry: (wrong: string, right: string) =>
    fetch("/api/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wrong, right }),
    }).then((r) => json<{ entries: DictEntry[] }>(r)),

  deleteDictEntry: (id: string) =>
    fetch(`/api/dictionary/${id}`, { method: "DELETE" }).then((r) =>
      json<{ entries: DictEntry[] }>(r)
    ),

  getFonts: () => fetch("/api/fonts").then((r) => json<{ groups: FontGroup[] }>(r)),

  getStyle: () => fetch("/api/style").then((r) => json<SubtitleStyle>(r)),

  saveStyle: (s: SubtitleStyle) =>
    fetch("/api/style", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    }).then((r) => json<SubtitleStyle>(r)),

  getAsr: () => fetch("/api/asr").then((r) => json<AsrSettings>(r)),

  saveAsr: (s: AsrSettings) =>
    fetch("/api/asr", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    }).then((r) => json<AsrSettings>(r)),

  getLlmStatus: () =>
    fetch("/api/llm/status").then((r) =>
      json<AiStatus & { languages: string[]; yt_dlp: boolean }>(r)
    ),

  getAiSettings: () => fetch("/api/ai").then((r) => json<AiStatus>(r)),

  saveAiSettings: (provider: AiProvider) =>
    fetch("/api/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    }).then((r) => json<AiStatus>(r)),

  startTranslate: (id: string, target: string) =>
    fetch(`/api/projects/${id}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    }).then((r) => json<TranslateJob>(r)),

  getTranslate: (id: string) =>
    fetch(`/api/projects/${id}/translate`).then((r) => json<TranslateJob>(r)),

  cancelTranslate: (id: string) =>
    fetch(`/api/projects/${id}/translate`, { method: "DELETE" }).then((r) =>
      json<TranslateJob>(r)
    ),

  /** 把所有譯文清掉,回到單語字幕。 */
  clearTranslate: (id: string) =>
    fetch(`/api/projects/${id}/translate?clear=true`, { method: "DELETE" }).then((r) =>
      json<TranslateJob>(r)
    ),

  startFix: (id: string) =>
    fetch(`/api/projects/${id}/fix`, { method: "POST" }).then((r) => json<FixJob>(r)),

  getFix: (id: string) =>
    fetch(`/api/projects/${id}/fix`).then((r) => json<FixJob>(r)),

  updateFix: (id: string, suggestions: { id: string; old: string; new: string }[]) =>
    fetch(`/api/projects/${id}/fix`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestions }),
    }).then((r) => json<{ ok: boolean }>(r)),

  cancelFix: (id: string) =>
    fetch(`/api/projects/${id}/fix`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),

  getWaveform: (id: string) =>
    fetch(`/api/projects/${id}/waveform`).then((r) =>
      json<{ rate: number; peaks: number[] }>(r)
    ),

  startBurn: (id: string) =>
    fetch(`/api/projects/${id}/burn`, { method: "POST" }).then((r) => json<BurnJob>(r)),

  getBurn: (id: string) =>
    fetch(`/api/projects/${id}/burn`).then((r) => json<BurnJob>(r)),

  cancelBurn: (id: string) =>
    fetch(`/api/projects/${id}/burn`, { method: "DELETE" }).then((r) =>
      json<{ ok: boolean }>(r)
    ),

  burnFileUrl: (id: string) => `/api/projects/${id}/burn/file`,

  mediaUrl: (id: string) => `/api/projects/${id}/media`,
  exportUrl: (id: string, format: string) => `/api/projects/${id}/export?format=${format}`,
};

/** 用 XHR 上傳才拿得到進度。 */
export function uploadMedia(
  file: File,
  onProgress: (ratio: number) => void
): Promise<Project> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/projects");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let msg = `上傳失敗(${xhr.status})`;
        try {
          msg = JSON.parse(xhr.responseText).detail ?? msg;
        } catch {
          /* keep default */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("連不上伺服器"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
