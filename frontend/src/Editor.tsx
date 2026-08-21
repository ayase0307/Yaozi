import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./api";
import Brand from "./Brand";
import { useHistoryState } from "./history";
import {
  activeIndexAt,
  formatTime,
  formatTimeMs,
  mergeSegments,
  readingSpeed,
  speedLevel,
  splitSegment,
  splitSegmentAtTime,
  uid,
} from "./segments";
import { diffParts } from "./diff";
import SafeFrame, { SAFE_FRAMES, matchPresetByRatio, useVideoRect } from "./SafeFrame";
import { SubtitleLines } from "./StyleControls";
import StylePanel from "./StylePanel";
import {
  RUNNING_STATUSES,
  statusLabel,
  type AiProvider,
  type BurnJob,
  type DictEntry,
  type FixJob,
  type FixSuggestion,
  type Project,
  type Segment,
  type SubtitleStyle,
  type TranslateJob,
} from "./types";
import Waveform from "./Waveform";

type SaveState = "saved" | "saving" | "dirty" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "已存本機",
  saving: "儲存中…",
  dirty: "編輯中…",
  error: "儲存失敗,稍後自動重試",
};

const EXPORT_FORMATS = [
  { format: "srt", label: "SRT 字幕檔" },
  { format: "srt-bi", label: "SRT 雙語字幕檔" },
  { format: "vtt", label: "VTT 字幕檔" },
  { format: "txt", label: "逐字稿(純文字)" },
  { format: "txt-ts", label: "逐字稿(含時間)" },
];

const HOTKEYS: [string, string][] = [
  ["Enter", "在游標處斷句"],
  ["Backspace", "句首按下與上句合併"],
  ["Tab / Shift+Tab", "跳到下一句 / 上一句"],
  ["空白鍵", "播放 / 暫停"],
  ["↑ ↓", "選句並跳到該時間"],
  ["B", "在播放位置切開字幕"],
  ["Delete", "刪除選中的字幕"],
  ["雙擊波形", "新增 / 移除 Mark 點"],
  ["Ctrl+Z / Ctrl+Y", "復原 / 重做"],
];

const round3 = (x: number) => Math.round(x * 1000) / 1000;

// 閱讀速度超標時字數會變色,滑過去說明是什麼意思
const SPEED_HINT: Record<"" | "warn" | "over", string> = {
  "": "",
  warn: " · 偏快,觀眾可能來不及看完",
  over: " · 太快了,這句要拉長或拆短",
};

const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
};

function jobPercent(job: FixJob | TranslateJob | null): number {
  if (!job) return 0;
  const ratio = job.progress ?? (job.done ?? 0) / Math.max(job.total ?? 1, 1);
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

interface EditingState {
  id: string;
  cursor: number;
}

export default function Editor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const history = useHistoryState<Segment[]>([]);
  const segments = history.value;
  // 這些函式引用是穩定的,拿出來當 dependency 用
  const { set: setSegments, reset: resetSegments, undo: undoHistory, redo: redoHistory } = history;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const [peaks, setPeaks] = useState<{ rate: number; peaks: number[] } | null>(null);
  const [marks, setMarks] = useState<number[]>([]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const justLoadedMarksRef = useRef<number[] | null>(null);
  const [cuts, setCuts] = useState<number[]>([]);
  const [cutsStatus, setCutsStatus] = useState("idle");
  const [safeFrame, setSafeFrame] = useState("off");
  const [burnJob, setBurnJob] = useState<BurnJob | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const selectedIdxRef = useRef(selectedIdx);
  selectedIdxRef.current = selectedIdx;
  const [query, setQuery] = useState("");

  const [llmAvailable, setLlmAvailable] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProvider>("claude");
  const [languages, setLanguages] = useState<string[]>([]);
  const [transJob, setTransJob] = useState<TranslateJob | null>(null);
  const translating = transJob?.status === "running";
  const translatingRef = useRef(translating);
  translatingRef.current = translating;
  const transMenuRef = useRef<HTMLDetailsElement>(null);
  const [fixJob, setFixJob] = useState<FixJob | null>(null);
  const [reviewItems, setReviewItems] = useState<FixSuggestion[] | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [subStyle, setSubStyle] = useState<SubtitleStyle | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  // 波形區固定吃掉 245px,校對的時候根本不看它。收起來字幕列表就多七八句。
  const [waveOpen, setWaveOpen] = useState(
    () => localStorage.getItem("yaozi:wave-open") !== "0"
  );

  const [resegmenting, setResegmenting] = useState(false);
  const [dictOpen, setDictOpen] = useState(false);
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([]);
  const [dictWrong, setDictWrong] = useState("");
  const [dictRight, setDictRight] = useState("");
  const [dictMsg, setDictMsg] = useState("");

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;

  const videoRef = useRef<HTMLVideoElement>(null);
  // 影片要 status === "done" 才會出現在畫面上,rect 得等到那時候才算得出來
  const videoRect = useVideoRect(videoRef, project?.status === "done");
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const loadedRef = useRef(false);
  const justLoadedRef = useRef<Segment[] | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const exportMenuRef = useRef<HTMLDetailsElement>(null);

  const running = project ? RUNNING_STATUSES.includes(project.status) : false;

  const rename = useCallback(
    (name: string) => {
      setProject((p) => (p ? { ...p, name } : p));
      api.patchProject(projectId, { name }).then(setProject).catch(() => {});
    },
    [projectId]
  );

  const setTrim = useCallback(
    (trim: Project["trim"]) => {
      setProject((p) => (p ? { ...p, trim } : p));
      api.patchProject(projectId, { trim }).then(setProject).catch(() => {});
    },
    [projectId]
  );

  const loadSubtitles = useCallback(() => {
    api.getSubtitles(projectId).then((s) => {
      justLoadedRef.current = s.segments;
      loadedRef.current = true;
      resetSegments(s.segments);
      const m = s.marks ?? [];
      justLoadedMarksRef.current = m;
      setMarks(m);
    });
  }, [projectId, resetSegments]);

  // 初次載入
  useEffect(() => {
    let alive = true;
    api
      .getProject(projectId)
      .then((p) => {
        if (!alive) return;
        setProject(p);
        if (p.status === "done") loadSubtitles();
      })
      .catch((e: Error) => setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId, loadSubtitles]);

  // 辨識進行中輪詢進度
  useEffect(() => {
    if (!project || !RUNNING_STATUSES.includes(project.status)) return;
    const timer = setInterval(() => {
      api
        .getProject(projectId)
        .then((p) => {
          setProject(p);
          if (p.status === "done") loadSubtitles();
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [project?.status, projectId, loadSubtitles]); // eslint-disable-line react-hooks/exhaustive-deps

  // 重新整理頁面後,把進行中(或剛完成)的燒錄/AI 校正狀態接回來
  useEffect(() => {
    if (project?.status !== "done") return;
    let alive = true;
    api
      .getBurn(projectId)
      .then((j) => {
        if (alive && (j.status === "running" || j.status === "done")) setBurnJob(j);
      })
      .catch(() => {});
    api
      .getFix(projectId)
      .then((j) => {
        if (!alive) return;
        if (j.status === "running") {
          setFixJob(j);
        } else if (j.status === "done" && j.suggestions?.length) {
          setFixJob(j);
          setReviewItems(j.suggestions);
        }
      })
      .catch(() => {});
    api
      .getTranslate(projectId)
      .then((j) => {
        if (alive && j.status === "running") setTransJob(j);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project?.status, projectId]);

  // 波形資料(完成後載入)
  useEffect(() => {
    if (project?.status !== "done") return;
    let alive = true;
    api
      .getWaveform(projectId)
      .then((w) => {
        if (alive) setPeaks(w);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project?.status, projectId]);

  // 設定中選定的 AI CLI 可用性(不可用就整塊隱藏)
  useEffect(() => {
    api
      .getLlmStatus()
      .then((s) => {
        setLlmAvailable(s.available);
        setAiProvider(s.provider);
        setLanguages(s.languages ?? []);
      })
      .catch(() => {});
  }, []);

  // 字幕外觀:載進來給影片上的預覽用,燒錄時後端會讀同一份設定
  useEffect(() => {
    api
      .getStyle()
      .then(setSubStyle)
      .catch(() => {});
  }, []);

  // AI 校正進行中輪詢進度;完成後打開審閱面板
  useEffect(() => {
    if (fixJob?.status !== "running") return;
    const timer = setInterval(() => {
      api
        .getFix(projectId)
        .then((j) => {
          setFixJob(j);
          if (j.status === "done") {
            const items = j.suggestions ?? [];
            if (items.length) {
              setReviewItems(items);
            } else {
              alert("AI 檢查完了,沒有找到需要修正的地方。");
              api.cancelFix(projectId).catch(() => {});
              setFixJob(null);
            }
          } else if (j.status === "error") {
            alert(`AI 校正失敗:${j.error ?? "未知錯誤"}`);
            api.cancelFix(projectId).catch(() => {});
            setFixJob(null);
          }
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [fixJob?.status, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 翻譯是後端直接寫進 subtitles.json 的,前端只把 trans 併回來(按 id 對,
  // 這樣使用者一邊翻一邊增刪句子也不會對錯行),原文以畫面上的為準。
  const mergeTrans = useCallback(() => {
    api
      .getSubtitles(projectId)
      .then((s) => {
        const byId = new Map(s.segments.map((x) => [x.id, x.trans]));
        setSegments((prev) => {
          let changed = false;
          const next = prev.map((seg) => {
            const t = byId.get(seg.id);
            if (t && seg.trans !== t) {
              changed = true;
              return { ...seg, trans: t };
            }
            return seg;
          });
          return changed ? next : prev;
        });
      })
      .catch(() => {});
  }, [projectId, setSegments]);

  // 翻譯進行中輪詢:每批完成就把譯文併進來,使用者看得到它一段一段長出來
  useEffect(() => {
    if (!translating) return;
    const timer = setInterval(() => {
      api
        .getTranslate(projectId)
        .then((j) => {
          setTransJob(j);
          mergeTrans();
          if (j.status === "error") {
            alert(`翻譯失敗:${j.error ?? "未知錯誤"}`);
            setTransJob(null);
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [translating, projectId, mergeTrans]);

  // 完成時短暫保留 100% 狀態，讓最後一批不會一完成就整張卡消失。
  useEffect(() => {
    if (transJob?.status !== "done") return;
    const timer = window.setTimeout(
      () => setTransJob((current) => (current?.status === "done" ? null : current)),
      1800
    );
    return () => window.clearTimeout(timer);
  }, [transJob?.status]);

  // AI 工作、辨識進行時每秒跳動的計時器,讓使用者看得出工作還活著
  useEffect(() => {
    if (fixJob?.status !== "running" && !translating && !running) return;
    setNowTick(Date.now());
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [fixJob?.status, translating, running]);

  // 播放中用 rAF 平滑更新時間(timeupdate 只有 4Hz,播放頭會頓)
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setCurrentTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // 自動存檔(0.8 秒沒動作就送出;失敗 3 秒後重試)
  const doSave = useCallback(() => {
    if (translatingRef.current) {
      // 翻譯期間後端正在寫同一份 subtitles.json,現在送出會蓋掉剛翻好的那批,先等它
      saveTimer.current = window.setTimeout(doSave, 1500);
      return;
    }
    setSaveState("saving");
    api
      .saveSubtitles(projectId, segmentsRef.current, marksRef.current)
      .then(() => setSaveState("saved"))
      .catch(() => {
        setSaveState("error");
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(doSave, 3000);
      });
  }, [projectId]);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (justLoadedRef.current === segments) return;
    setSaveState("dirty");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(doSave, 800);
    return () => window.clearTimeout(saveTimer.current);
  }, [segments, doSave]);

  // Mark 點變動也觸發自動存檔
  useEffect(() => {
    if (!loadedRef.current) return;
    if (justLoadedMarksRef.current === marks) return;
    setSaveState("dirty");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(doSave, 800);
    return () => window.clearTimeout(saveTimer.current);
  }, [marks, doSave]);

  // 切點:載入既有結果;偵測中每 2 秒輪詢
  useEffect(() => {
    if (project?.status !== "done") return;
    let alive = true;
    api
      .getCuts(projectId)
      .then((c) => {
        if (!alive) return;
        setCuts(c.cuts);
        setCutsStatus(c.status === "running" ? "running" : c.cuts.length ? "done" : "idle");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project?.status, projectId]);

  useEffect(() => {
    if (cutsStatus !== "running") return;
    const timer = setInterval(() => {
      api
        .getCuts(projectId)
        .then((c) => {
          if (c.status === "done") {
            setCuts(c.cuts);
            setCutsStatus("done");
          } else if (c.status === "error") {
            alert(`切點偵測失敗:${c.error ?? "未知錯誤"}`);
            setCutsStatus("idle");
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [cutsStatus, projectId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveStateRef.current !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ---- 編輯操作 ----

  const commitText = useCallback(
    (id: string, draft: string) => {
      setSegments((prev) => {
        const i = prev.findIndex((s) => s.id === id);
        if (i < 0 || prev[i].text === draft) return prev;
        const next = [...prev];
        next[i] = { ...next[i], text: draft };
        return next;
      });
    },
    [setSegments]
  );

  const commitTrans = useCallback(
    (id: string, text: string) => {
      setSegments((prev) => {
        const i = prev.findIndex((s) => s.id === id);
        if (i < 0 || (prev[i].trans ?? "") === text) return prev;
        const next = [...prev];
        next[i] = { ...next[i], trans: text };
        return next;
      });
    },
    [setSegments]
  );

  const handleBlur = useCallback(
    (id: string, draft: string) => {
      commitText(id, draft);
      setEditing((e) => (e && e.id === id ? null : e));
    },
    [commitText]
  );

  const handleEsc = useCallback(
    (id: string, draft: string) => {
      commitText(id, draft);
      setEditing(null);
    },
    [commitText]
  );

  const handleSplit = useCallback(
    (id: string, draft: string, pos: number) => {
      const prev = segmentsRef.current;
      const i = prev.findIndex((s) => s.id === id);
      if (i < 0) return;
      const pair = splitSegment({ ...prev[i], text: draft }, pos);
      if (!pair) {
        commitText(id, draft);
        return;
      }
      setSegments(() => {
        const next = [...prev];
        next.splice(i, 1, pair[0], pair[1]);
        return next;
      });
      setEditing({ id: pair[1].id, cursor: 0 });
      setSelectedIdx(i + 1);
    },
    [commitText, setSegments]
  );

  const handleMergeUp = useCallback(
    (id: string, draft: string) => {
      const prev = segmentsRef.current;
      const i = prev.findIndex((s) => s.id === id);
      if (i <= 0) return;
      const merged = mergeSegments(prev[i - 1], { ...prev[i], text: draft });
      const cursor = prev[i - 1].text.length;
      setSegments(() => {
        const next = [...prev];
        next.splice(i - 1, 2, merged);
        return next;
      });
      setEditing({ id: merged.id, cursor });
      setSelectedIdx(i - 1);
    },
    [setSegments]
  );

  const handleTab = useCallback(
    (id: string, draft: string, dir: 1 | -1) => {
      commitText(id, draft);
      const prev = segmentsRef.current;
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) {
        setEditing(null);
        return;
      }
      setEditing({ id: prev[j].id, cursor: prev[j].text.length });
      setSelectedIdx(j);
    },
    [commitText]
  );

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, t + 0.001);
    setCurrentTime(v.currentTime);
  }, []);

  const handleRowClick = useCallback(
    (index: number) => {
      const s = segmentsRef.current[index];
      if (!s) return;
      setSelectedIdx(index);
      if (editingRef.current?.id !== s.id) seekTo(s.start);
    },
    [seekTo]
  );

  const handleStartEdit = useCallback((id: string, cursor: number) => {
    setEditing({ id, cursor });
  }, []);

  // 波形區:拖完提交時間。拖過鄰句會改變順序,必須重排,
  // 不然「找播放中那句」的二分搜尋與磁吸鄰居都會抓錯。
  const handleCommitTimes = useCallback(
    (id: string, start: number, end: number) => {
      const prev = segmentsRef.current;
      const i = prev.findIndex((s) => s.id === id);
      if (i < 0) return;
      const next = [...prev];
      next[i] = { ...next[i], start: round3(start), end: round3(end) };
      next.sort((a, b) => a.start - b.start || a.end - b.end);
      setSegments(() => next);
      setSelectedIdx(next.findIndex((s) => s.id === id));
    },
    [setSegments]
  );

  // 波形區:空白處拖選新增字幕
  const handleCreate = useCallback(
    (start: number, end: number) => {
      const seg: Segment = { id: uid(), start: round3(start), end: round3(end), text: "", words: [] };
      const prev = segmentsRef.current;
      let i = prev.findIndex((s) => s.start > seg.start);
      if (i < 0) i = prev.length;
      setSegments(() => {
        const next = [...prev];
        next.splice(i, 0, seg);
        return next;
      });
      setSelectedIdx(i);
      setEditing({ id: seg.id, cursor: 0 });
    },
    [setSegments]
  );

  const addMark = useCallback((t: number) => {
    setMarks((prev) => (prev.includes(t) ? prev : [...prev, t].sort((a, b) => a - b)));
  }, []);

  const removeMark = useCallback((t: number) => {
    setMarks((prev) => prev.filter((m) => m !== t));
  }, []);

  const detectCuts = useCallback(() => {
    api
      .startCuts(projectId)
      .then(() => setCutsStatus("running"))
      .catch((e: Error) => alert(e.message));
  }, [projectId]);

  const deleteSegment = useCallback(
    (idx: number) => {
      const prev = segmentsRef.current;
      if (idx < 0 || idx >= prev.length) return;
      setSegments(() => {
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      });
      setSelectedIdx(-1);
      setEditing(null);
    },
    [setSegments]
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }, []);

  const toggleWave = useCallback(() => {
    setWaveOpen((v) => {
      localStorage.setItem("yaozi:wave-open", v ? "0" : "1");
      return !v;
    });
  }, []);

  const undo = useCallback(() => {
    setEditing(null);
    undoHistory();
  }, [undoHistory]);

  const redo = useCallback(() => {
    setEditing(null);
    redoHistory();
  }, [redoHistory]);

  // 全域快捷鍵(編輯框內不攔截)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (key === "b" && !ctrl) {
        e.preventDefault();
        const list = segmentsRef.current;
        const t = videoRef.current?.currentTime ?? 0;
        const i = activeIndexAt(list, t);
        if (i >= 0) {
          const pair = splitSegmentAtTime(list[i], t);
          if (pair) {
            setSegments(() => {
              const next = [...list];
              next.splice(i, 1, ...pair);
              return next;
            });
            setSelectedIdx(i + 1);
          }
        }
        return;
      }
      if ((key === "i" || key === "o") && !ctrl) {
        e.preventDefault();
        const t = videoRef.current?.currentTime ?? 0;
        setProject((p) => {
          if (!p?.duration) return p;
          const a = key === "i" ? t : (p.trim?.start ?? 0);
          const b = key === "o" ? t : (p.trim?.end ?? p.duration);
          const lo = Math.max(0, Math.min(a, b - 0.5));
          const hi = Math.min(p.duration, Math.max(b, lo + 0.5));
          const trim = lo <= 0 && hi >= p.duration - 0.01 ? null : { start: lo, end: hi };
          api.patchProject(projectId, { trim }).catch(() => {});
          return { ...p, trim };
        });
        return;
      }
      if (e.key === "Delete") {
        const i = selectedIdxRef.current;
        if (i >= 0) {
          e.preventDefault();
          deleteSegment(i);
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = segmentsRef.current;
        if (!list.length) return;
        const cur = selectedIdxRef.current;
        const next =
          e.key === "ArrowDown"
            ? Math.min(cur < 0 ? 0 : cur + 1, list.length - 1)
            : Math.max(cur < 0 ? 0 : cur - 1, 0);
        setSelectedIdx(next);
        seekTo(list[next].start);
        rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter") {
        const list = segmentsRef.current;
        const cur = selectedIdxRef.current;
        if (cur >= 0 && cur < list.length) {
          e.preventDefault();
          setEditing({ id: list[cur].id, cursor: list[cur].text.length });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, seekTo, togglePlay, setSegments, deleteSegment, projectId]);

  const activeIdx = useMemo(() => activeIndexAt(segments, currentTime), [segments, currentTime]);

  // 播放時讓目前那句自動捲進視野(搜尋過濾中不捲)
  useEffect(() => {
    if (!isPlaying || editing || activeIdx < 0 || query) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rowRefs.current[activeIdx]?.scrollIntoView({
      block: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [activeIdx, isPlaying, editing, query]);

  // 搜尋過濾(保留原始索引,操作照常)
  const rows = useMemo(() => {
    const all = segments.map((seg, idx) => ({ seg, idx }));
    if (!query.trim()) return all;
    return all.filter((r) => r.seg.text.includes(query.trim()));
  }, [segments, query]);

  // 資訊列:選中句優先,沒有就用播放中那句
  const statIdx = selectedIdx >= 0 ? selectedIdx : activeIdx;
  const statSeg = statIdx >= 0 ? segments[statIdx] : null;

  const retranscribe = () => {
    if (
      segmentsRef.current.length > 0 &&
      !confirm(
        "重新辨識會覆蓋目前的字幕(舊字幕會備份成專案資料夾裡的 subtitles.bak.json)。確定繼續?"
      )
    ) {
      return;
    }
    api
      .retranscribe(projectId)
      .then(setProject)
      .catch((e: Error) => alert(e.message));
  };

  // ---- AI 校正 ----

  const startFix = () => {
    api
      .startFix(projectId)
      .then(setFixJob)
      .catch((e: Error) => alert(e.message));
  };

  // ---- 翻譯 ----

  const startTranslate = (target: string) => {
    if (transMenuRef.current) transMenuRef.current.open = false;
    // 先把未存的編輯沖掉,後端才會照最新的原文翻
    window.clearTimeout(saveTimer.current);
    api
      .saveSubtitles(projectId, segmentsRef.current, marksRef.current)
      .then(() => {
        setSaveState("saved");
        return api.startTranslate(projectId, target);
      })
      .then(setTransJob)
      .catch((e: Error) => alert(e.message));
  };

  const cancelTranslate = () => {
    api.cancelTranslate(projectId).catch(() => {});
    setTransJob(null);
  };

  const clearTranslate = () => {
    if (transMenuRef.current) transMenuRef.current.open = false;
    if (!confirm("清除所有譯文?原文不受影響。")) return;
    api
      .clearTranslate(projectId)
      .then(() => {
        setTransJob(null);
        setSegments((prev) => prev.map((s) => (s.trans ? { ...s, trans: undefined } : s)));
      })
      .catch((e: Error) => alert(e.message));
  };

  const cancelFix = () => {
    if (!confirm("取消這次 AI 校正?")) return;
    api.cancelFix(projectId).catch(() => {});
    setFixJob(null);
  };

  const dismissReview = useCallback(() => {
    api.cancelFix(projectId).catch(() => {});
    setReviewItems(null);
    setFixJob(null);
  }, [projectId]);

  const acceptOne = useCallback(
    (s: FixSuggestion) => {
      setSegments((prev) => {
        const i = prev.findIndex((x) => x.id === s.id);
        if (i < 0 || prev[i].text !== s.old) return prev;
        const next = [...prev];
        next[i] = { ...next[i], text: s.new };
        return next;
      });
      const next = (reviewItems ?? []).filter((x) => x !== s);
      api.updateFix(projectId, next).catch(() => {}); // 剩餘清單落地,重開伺服器能接著審
      setReviewItems(next.length ? next : null);
    },
    [setSegments, reviewItems, projectId]
  );

  const skipOne = useCallback(
    (s: FixSuggestion) => {
      const next = (reviewItems ?? []).filter((x) => x !== s);
      api.updateFix(projectId, next).catch(() => {});
      setReviewItems(next.length ? next : null);
    },
    [reviewItems, projectId]
  );

  const acceptAll = useCallback(() => {
    const items = reviewItems ?? [];
    setSegments((prev) => {
      let changed = false;
      const next = [...prev];
      for (const s of items) {
        const i = next.findIndex((x) => x.id === s.id);
        if (i >= 0 && next[i].text === s.old) {
          next[i] = { ...next[i], text: s.new };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    dismissReview();
  }, [reviewItems, setSegments, dismissReview]);

  const seekToSuggestion = useCallback(
    (s: FixSuggestion) => {
      const i = segmentsRef.current.findIndex((x) => x.id === s.id);
      if (i >= 0) {
        setSelectedIdx(i);
        seekTo(segmentsRef.current[i].start);
        rowRefs.current[i]?.scrollIntoView({ block: "center" });
      }
    },
    [seekTo]
  );

  // ---- 成品影片匯出 ----

  const startBurn = useCallback(() => {
    // 先把未存的編輯沖掉,燒錄才會拿到最新字幕
    window.clearTimeout(saveTimer.current);
    api
      .saveSubtitles(projectId, segmentsRef.current, marksRef.current)
      .then(() => {
        setSaveState("saved");
        return api.startBurn(projectId);
      })
      .then(setBurnJob)
      .catch((e: Error) => alert(e.message));
  }, [projectId]);

  const cancelBurn = useCallback(() => {
    api.cancelBurn(projectId).catch(() => {});
    setBurnJob(null);
  }, [projectId]);

  useEffect(() => {
    if (burnJob?.status !== "running") return;
    const timer = setInterval(() => {
      api
        .getBurn(projectId)
        .then((j) => {
          if (j.status === "error") {
            alert(`匯出失敗:${j.error ?? "未知錯誤"}`);
            api.cancelBurn(projectId).catch(() => {});
            setBurnJob(null);
          } else {
            setBurnJob(j);
          }
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [burnJob?.status, projectId]);

  // ---- 詞庫 ----

  const openDict = () => {
    setDictOpen(true);
    setDictMsg("");
    api
      .getDictionary()
      .then((d) => setDictEntries(d.entries))
      .catch(() => {});
  };

  const addDictEntry = (e: React.FormEvent) => {
    e.preventDefault();
    api
      .addDictEntry(dictWrong, dictRight)
      .then((d) => {
        setDictEntries(d.entries);
        setDictWrong("");
        setDictRight("");
        setDictMsg("已加入,之後每次辨識完會自動取代。");
      })
      .catch((err: Error) => setDictMsg(err.message));
  };

  const removeDictEntry = (id: string) => {
    api
      .deleteDictEntry(id)
      .then((d) => setDictEntries(d.entries))
      .catch(() => {});
  };

  const applyDictNow = () => {
    const prev = segmentsRef.current;
    const sorted = [...dictEntries].sort((a, b) => b.wrong.length - a.wrong.length);
    let count = 0;
    const next = prev.map((s) => {
      let t = s.text;
      for (const e of sorted) {
        const parts = t.split(e.wrong);
        if (parts.length > 1) {
          count += parts.length - 1;
          t = parts.join(e.right);
        }
      }
      return t === s.text ? s : { ...s, text: t };
    });
    if (count === 0) {
      setDictMsg("目前字幕沒有符合詞庫的內容。");
      return;
    }
    setSegments(() => next);
    setDictMsg(`已取代 ${count} 處(可 Ctrl+Z 復原)。`);
  };

  // 用現在的斷句設定把整份字幕重排一次,不必重跑辨識(結果照常進復原堆疊)
  const resegmentNow = () => {
    if (resegmenting || !segmentsRef.current.length) return;
    // 譯文沒有單字時間戳,跟著原文重排只能整段留在前一句,重排完得再翻一次
    if (
      segmentsRef.current.some((s) => s.trans) &&
      !confirm("重新斷句會讓譯文對不上原文,之後要重新翻譯一次。要繼續嗎?")
    )
      return;
    setResegmenting(true);
    api
      .resegment(segmentsRef.current)
      .then((d) => setSegments(() => d.segments))
      .catch((e) => setLoadError(String(e.message ?? e)))
      .finally(() => setResegmenting(false));
  };

  // 審閱清單清空後,順手清掉後端的工作狀態
  useEffect(() => {
    if (reviewItems === null && fixJob?.status === "done") {
      api.cancelFix(projectId).catch(() => {});
      setFixJob(null);
    }
  }, [reviewItems, fixJob?.status, projectId]);

  // ---- 畫面 ----

  if (loadError || !project) {
    return (
      <div className="page">
        <EditorTopbar project={null} saveState="saved" projectId={projectId} />
        <main className="editor-message">
          <p>{loadError ?? "載入中…"}</p>
          {loadError && <a href="#/">回專案列表</a>}
        </main>
      </div>
    );
  }

  if (running || project.status !== "done") {
    return (
      <div className="page">
        <EditorTopbar
          project={project}
          saveState="saved"
          projectId={projectId}
          onRename={rename}
        />
        <main className="editor-message">
          <ProgressCard project={project} now={nowTick} onRetry={retranscribe} />
        </main>
      </div>
    );
  }

  const activeText = activeIdx >= 0 ? segments[activeIdx].text : "";

  return (
    <div className="page">
      <EditorTopbar
        project={project}
        saveState={saveState}
        projectId={projectId}
        exportMenuRef={exportMenuRef}
        onBurn={startBurn}
        onRename={rename}
      />

      {!waveOpen ? null : peaks && project.duration ? (
        <Waveform
          peaks={peaks}
          duration={project.duration}
          segments={segments}
          currentTime={currentTime}
          activeIdx={activeIdx}
          selectedIdx={selectedIdx}
          isPlaying={isPlaying}
          cuts={cuts}
          marks={marks}
          cutsStatus={cutsStatus}
          onDetectCuts={detectCuts}
          onAddMark={addMark}
          onRemoveMark={removeMark}
          onSeek={seekTo}
          onSelect={setSelectedIdx}
          onCommitTimes={handleCommitTimes}
          onCreate={handleCreate}
          trim={project.trim}
        />
      ) : (
        <div className="wave-strip wave-loading">波形載入中…</div>
      )}

      <div className="toolbar">
        <button
          className="play-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? "暫停" : "播放"}
        >
          {isPlaying ? (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <rect x="3" y="2" width="4" height="12" rx="1" fill="currentColor" />
              <rect x="9" y="2" width="4" height="12" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className="time-display">
          {formatTimeMs(currentTime)}
          <span className="time-total">
            {" / "}
            {project.duration ? formatTime(project.duration) : "--:--"}
          </span>
        </span>
        <span className="toolbar-sep" aria-hidden />
        <TrimControls
          trim={project.trim}
          currentTime={currentTime}
          duration={project.duration ?? 0}
          onChange={setTrim}
          onSeek={seekTo}
        />
        <span className="toolbar-sep" aria-hidden />
        <button
          className={"icon-btn" + (waveOpen ? " on" : "")}
          onClick={toggleWave}
          aria-pressed={waveOpen}
          title={waveOpen ? "收起波形區,字幕列表變長" : "展開波形區"}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            {[2, 5, 8, 11, 14].map((x, i) => {
              const h = [5, 11, 8, 13, 6][i];
              return (
                <rect
                  key={x}
                  x={x - 0.9}
                  y={(16 - h) / 2}
                  width="1.8"
                  height={h}
                  rx="0.9"
                  fill="currentColor"
                />
              );
            })}
          </svg>
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button className="icon-btn" onClick={undo} title="復原 (Ctrl+Z)">
          ↺
        </button>
        <button className="icon-btn" onClick={redo} title="重做 (Ctrl+Y)">
          ↻
        </button>
        <span className="toolbar-spacer" />
        <button
          className="btn small"
          onClick={resegmentNow}
          disabled={resegmenting || !segments.length}
          title="照設定裡的每句字數重排全部字幕:碎片黏回完整句子、太長的切開(可 Ctrl+Z 復原)"
        >
          {resegmenting ? "重排中…" : "重新斷句"}
        </button>
        <button className="btn small" onClick={openDict} title="管理錯字自動取代清單">
          詞庫
        </button>
        <button
          className="btn small"
          onClick={() => setStyleOpen((v) => !v)}
          title="字型、字級、顏色——影片上即時預覽,燒錄成品用同一組設定"
        >
          字幕外觀
        </button>
        {llmAvailable &&
          languages.length > 0 &&
          (translating ? (
            <button className="btn small" onClick={cancelTranslate} title="點擊取消">
              <span className="spinner" aria-hidden /> 翻譯中 {jobPercent(transJob)}%
            </button>
          ) : (
            <details className="hotkey-menu" ref={transMenuRef}>
              <summary className="btn small" title="翻成別的語言,原文與譯文一起顯示/燒錄">
                翻譯
              </summary>
              <div className="hotkey-panel trans-panel">
                {languages.map((lang) => (
                  <button key={lang} className="trans-item" onClick={() => startTranslate(lang)}>
                    翻成{lang}
                  </button>
                ))}
                <button className="trans-item danger" onClick={clearTranslate}>
                  清除譯文
                </button>
              </div>
            </details>
          ))}
        {llmAvailable &&
          (fixJob?.status === "running" ? (
            <button className="btn small" onClick={cancelFix} title="點擊取消">
              <span className="spinner" aria-hidden /> AI 校正中 {jobPercent(fixJob)}%
            </button>
          ) : (
            <button
              className="btn small"
              onClick={startFix}
              title={`用 ${AI_PROVIDER_LABELS[aiProvider]} 檢查錯字與用語`}
            >
              AI 校正
            </button>
          ))}
        <details className="hotkey-menu">
          <summary className="btn small">快捷鍵</summary>
          <div className="hotkey-panel">
            {HOTKEYS.map(([key, desc]) => (
              <div key={key} className="hotkey-row">
                <kbd>{key}</kbd>
                <span>{desc}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      <main className="editor">
        <section className="player-pane">
          <div className={"video-wrap" + (project.has_video === false ? " audio-only" : "")}>
            <video
              ref={videoRef}
              src={api.mediaUrl(projectId)}
              controls
              preload="metadata"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onLoadedMetadata={(e) => {
                const stored = localStorage.getItem(`yaozi:safeframe:${projectId}`);
                setSafeFrame(
                  stored ??
                    matchPresetByRatio(
                      e.currentTarget.videoWidth,
                      e.currentTarget.videoHeight
                    )
                );
              }}
            />
            <SafeFrame videoRef={videoRef} frameKey={safeFrame} />
            {activeText && subStyle && (
              // 疊在影片實際畫面上,尺寸按同一組百分比換算,所見即為燒出來的樣子
              <div
                className="subtitle-overlay"
                style={videoRect ?? { left: 0, top: 0, right: 0, bottom: 0 }}
              >
                <SubtitleLines
                  style={subStyle}
                  height={videoRect?.height ?? 0}
                  text={activeText}
                  trans={activeIdx >= 0 ? segments[activeIdx].trans : undefined}
                />
              </div>
            )}
          </div>
          <div className="player-controls">
            <label className="wave-zoom-label" htmlFor="safeframe-select">
              安全框
            </label>
            <select
              id="safeframe-select"
              className="select"
              value={safeFrame}
              onChange={(e) => {
                setSafeFrame(e.target.value);
                localStorage.setItem(`yaozi:safeframe:${projectId}`, e.target.value);
              }}
            >
              {SAFE_FRAMES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="hint">紅色斜紋是平台 UI 會遮住的區域,字幕壓到就該換行</span>
          </div>
        </section>

        <section className="subtitle-pane">
          <div className="search-bar">
            <svg className="search-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋字幕"
              aria-label="搜尋字幕"
            />
            {query && (
              <button className="link-btn" onClick={() => setQuery("")}>
                清除
              </button>
            )}
          </div>

          <div className="sub-list">
            {segments.length === 0 ? (
              <div className="editor-message">
                <p>沒有辨識到任何語音。</p>
                <button className="btn" onClick={retranscribe}>
                  重新辨識
                </button>
              </div>
            ) : rows.length === 0 ? (
              <p className="empty-hint">沒有符合「{query}」的字幕。</p>
            ) : (
              rows.map(({ seg, idx }) => (
                <Row
                  key={seg.id}
                  seg={seg}
                  index={idx}
                  isActive={idx === activeIdx}
                  isSelected={idx === selectedIdx}
                  editingCursor={editing?.id === seg.id ? editing.cursor : null}
                  rowRef={(el) => (rowRefs.current[idx] = el)}
                  onRowClick={handleRowClick}
                  onStartEdit={handleStartEdit}
                  onBlurCommit={handleBlur}
                  onEsc={handleEsc}
                  onSplit={handleSplit}
                  onMergeUp={handleMergeUp}
                  onTab={handleTab}
                  onDelete={deleteSegment}
                  onTransCommit={commitTrans}
                />
              ))
            )}
          </div>

          {statSeg && (
            <div className="stats-bar">
              <span className="mono">{formatTimeMs(statSeg.start)}</span>
              <span>{(statSeg.end - statSeg.start).toFixed(2)} 秒</span>
              <span>{statSeg.text.replace(/\s/g, "").length} 字</span>
              <span className={"speed " + speedLevel(statSeg)}>
                {readingSpeed(statSeg).toFixed(1)} 字寬/秒
                {SPEED_HINT[speedLevel(statSeg)]}
              </span>
              {statIdx > 0 && (
                <span>
                  與前句間隔 {(statSeg.start - segments[statIdx - 1].end).toFixed(2)} 秒
                </span>
              )}
            </div>
          )}
        </section>
      </main>

      {styleOpen && subStyle && (
        <StylePanel
          value={subStyle}
          onChange={setSubStyle}
          onClose={() => setStyleOpen(false)}
        />
      )}

      {dictOpen && (
        <div className="fix-panel" role="dialog" aria-label="詞庫">
          <div className="fix-head">
            <span className="fix-title">詞庫({dictEntries.length})</span>
            <span className="toolbar-spacer" />
            <button
              className="btn small"
              onClick={applyDictNow}
              disabled={!dictEntries.length}
            >
              套用到目前字幕
            </button>
            <button className="btn small" onClick={() => setDictOpen(false)}>
              關閉
            </button>
          </div>
          <form className="dict-form" onSubmit={addDictEntry}>
            <input
              value={dictWrong}
              onChange={(e) => setDictWrong(e.target.value)}
              placeholder="錯誤寫法(例:一加一)"
              aria-label="錯誤寫法"
            />
            <span className="dict-arrow">→</span>
            <input
              value={dictRight}
              onChange={(e) => setDictRight(e.target.value)}
              placeholder="正確寫法(例:壹加壹)"
              aria-label="正確寫法"
            />
            <button
              className="btn small primary"
              type="submit"
              disabled={!dictWrong.trim() || !dictRight.trim()}
            >
              加入
            </button>
          </form>
          {dictMsg && <div className="dict-msg">{dictMsg}</div>}
          <div className="fix-list">
            {dictEntries.length === 0 ? (
              <p className="hint">
                還沒有詞。加入「錯誤寫法 → 正確寫法」,之後每次辨識完會自動取代;
                也可以按上面的按鈕套用到目前字幕。
              </p>
            ) : (
              dictEntries.map((e) => (
                <div key={e.id} className="dict-item">
                  <span className="dict-wrong">{e.wrong}</span>
                  <span className="dict-arrow">→</span>
                  <span className="dict-right">{e.right}</span>
                  <span className="toolbar-spacer" />
                  <button
                    className="row-delete visible"
                    onClick={() => removeDictEntry(e.id)}
                    title="從詞庫刪除"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {(fixJob?.status === "running" ||
        transJob?.status === "running" ||
        transJob?.status === "done" ||
        burnJob?.status === "running" ||
        burnJob?.status === "done") && (
        <div className="job-status-stack">
          {(transJob?.status === "running" || transJob?.status === "done") && (
            <AiJobStatus kind="translate" job={transJob} now={nowTick} onCancel={cancelTranslate} />
          )}
          {fixJob?.status === "running" && (
            <AiJobStatus kind="fix" job={fixJob} now={nowTick} onCancel={cancelFix} />
          )}
          {burnJob && (burnJob.status === "running" || burnJob.status === "done") && (
            <div className="fix-status" role="status">
              <div className="fix-status-head">
                {burnJob.status === "running" && <span className="spinner" aria-hidden />}
                <span className="fix-title">
                  {burnJob.status === "running" ? "匯出影片中" : "影片匯出完成"}
                </span>
                <span className="toolbar-spacer" />
                {burnJob.status === "running" ? (
                  <button className="btn small" onClick={cancelBurn}>取消</button>
                ) : (
                  <>
                    <a className="btn small primary" href={api.burnFileUrl(projectId)}>下載影片</a>
                    {/* 只清前端狀態的話,重整又會從後端撈回這張卡,一直賴在畫面右下角 */}
                    <button className="btn small" onClick={cancelBurn}>關閉</button>
                  </>
                )}
              </div>
              <span className="bar fix-status-bar">
                <span
                  className={"bar-fill" + (burnJob.status === "running" ? " pulsing" : "")}
                  style={{ width: `${Math.max(burnJob.progress * 100, 3)}%` }}
                />
              </span>
              {burnJob.status === "running" && (
                <div className="fix-status-info">
                  {Math.round(burnJob.progress * 100)}% · NVENC 硬體編碼(失敗自動改用 CPU)
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {reviewItems && (
        <div className="fix-panel" role="dialog" aria-label="AI 校正建議">
          <div className="fix-head">
            <span className="fix-title">AI 校正建議({reviewItems.length})</span>
            <span className="toolbar-spacer" />
            <button className="btn small primary" onClick={acceptAll}>
              全部接受
            </button>
            <button className="btn small" onClick={dismissReview}>
              關閉
            </button>
          </div>
          <div className="fix-list">
            {reviewItems.map((s) => {
              const d = diffParts(s.old, s.new);
              return (
                <div key={s.id + s.old} className="fix-item">
                  <button className="fix-text" onClick={() => seekToSuggestion(s)}>
                    <span>{d.pre}</span>
                    {d.aMid && <del>{d.aMid}</del>}
                    {d.bMid && <ins>{d.bMid}</ins>}
                    <span>{d.post}</span>
                  </button>
                  <div className="fix-actions">
                    <button className="btn small primary" onClick={() => acceptOne(s)}>
                      接受
                    </button>
                    <button className="btn small" onClick={() => skipOne(s)}>
                      略過
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AiJobStatus({
  kind,
  job,
  now,
  onCancel,
}: {
  kind: "translate" | "fix";
  job: TranslateJob | FixJob;
  now: number;
  onCancel: () => void;
}) {
  const percent = jobPercent(job);
  const total = Math.max(job.total ?? 1, 1);
  const done = Math.min(job.done ?? 0, total);
  const currentBatch = job.status === "done" ? total : Math.min(done + 1, total);
  const seconds = job.started_at ? Math.max(0, Math.floor(now / 1000 - job.started_at)) : 0;
  const provider = job.provider ? AI_PROVIDER_LABELS[job.provider] : "AI CLI";
  const translatingJob = kind === "translate" ? (job as TranslateJob) : null;
  const fixingJob = kind === "fix" ? (job as FixJob) : null;
  const title = kind === "translate" ? "字幕翻譯" : "AI 校正";

  return (
    <div className="fix-status ai-job-status" role="status" aria-live="polite">
      <div className="fix-status-head">
        {job.status === "running" && <span className="spinner" aria-hidden />}
        <span className="fix-title">{title}{job.status === "done" ? "完成" : "中"}</span>
        <span className="ai-job-provider">{provider}</span>
        <span className="toolbar-spacer" />
        <strong className="ai-job-percent">{percent}%</strong>
        {job.status === "running" && (
          <button className="btn small" onClick={onCancel}>取消</button>
        )}
      </div>
      <span className={"bar fix-status-bar ai-progress-track " + job.status}>
        <span className="bar-fill" style={{ width: `${percent}%` }} />
      </span>
      <div className="fix-status-info">
        第 {currentBatch}/{total} 批 · {translatingJob
          ? `翻成${translatingJob.target ?? "目標語言"}`
          : `已找到 ${fixingJob?.suggestions?.length ?? 0} 個建議`} · {seconds} 秒
      </div>
    </div>
  );
}

/** 剪輯範圍:設起點/終點,燒錄與匯出字幕都只出這一段。整段刪除、多段拼接不做。 */
function TrimControls({
  trim,
  currentTime,
  duration,
  onChange,
  onSeek,
}: {
  trim: Project["trim"];
  currentTime: number;
  duration: number;
  onChange: (t: Project["trim"]) => void;
  onSeek: (t: number) => void;
}) {
  const start = trim?.start ?? 0;
  const end = trim?.end ?? duration;
  const set = (a: number, b: number) => {
    const lo = Math.max(0, Math.min(a, b - 0.5));
    const hi = Math.min(duration, Math.max(b, lo + 0.5));
    onChange(lo <= 0 && hi >= duration - 0.01 ? null : { start: lo, end: hi });
  };
  return (
    <span className="trim-controls">
      <button
        className="icon-btn"
        onClick={() => set(currentTime, end)}
        title="把目前位置設成剪輯起點 (I)"
      >
        ⟦
      </button>
      <button
        className="icon-btn"
        onClick={() => set(start, currentTime)}
        title="把目前位置設成剪輯終點 (O)"
      >
        ⟧
      </button>
      {trim ? (
        <>
          <button
            className="trim-range mono"
            onClick={() => onSeek(trim.start)}
            title="跳到剪輯起點"
          >
            {formatTime(trim.start)}–{formatTime(trim.end)}
          </button>
          <button className="icon-btn" onClick={() => onChange(null)} title="取消剪輯,恢復整支影片">
            ✕
          </button>
        </>
      ) : (
        <span className="trim-hint">整支</span>
      )}
    </span>
  );
}

// 辨識的階段順序。status 落在哪一格,前面的就是做完的、後面的是還沒開始的。
const STAGES: { keys: Project["status"][]; label: string; note: string }[] = [
  { keys: ["downloading"], label: "下載影片", note: "從網址抓原始檔" },
  { keys: ["uploaded", "extracting"], label: "抽出聲音", note: "轉成辨識用的音軌" },
  { keys: ["loading_model"], label: "載入模型", note: "第一次會下載,要幾分鐘" },
  { keys: ["transcribing"], label: "聽打中", note: "faster-whisper 逐句辨識" },
  { keys: ["converting"], label: "斷句潤飾", note: "轉繁體、切開太長的句子" },
];

function elapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

/** 辨識進行中的畫面:看得出現在走到哪一步、已經跑了多久。 */
function ProgressCard({
  project,
  now,
  onRetry,
}: {
  project: Project;
  now: number;
  onRetry: () => void;
}) {
  // 這一輪從什麼時候開始算——後端沒記,以打開這個畫面的時間為準就夠用了
  const [since] = useState(() => Date.now());
  const failed = project.status === "error" || project.status === "interrupted";
  const current = STAGES.findIndex((s) => s.keys.includes(project.status));
  const at = project.status === "done" ? STAGES.length : current < 0 ? 0 : current;

  return (
    <div className="progress-card">
      <div className="progress-head">
        <span className={"progress-tag" + (failed ? " failed" : "")}>
          <span className="progress-dot" aria-hidden />
          {failed ? "已中斷" : "製作中"}
        </span>
        <span className="progress-elapsed mono">
          已經 {elapsed((now - since) / 1000)}
        </span>
      </div>
      <h2 className="progress-title">{failed ? statusLabel(project) : "字幕製作中"}</h2>
      <p className="progress-sub">
        {failed
          ? "從失敗的地方重跑就好,原本的字幕會先備份起來。"
          : "可以先去做別的事——這頁會自己更新,做完直接進編輯器。"}
      </p>

      <ol className="stage-list">
        {STAGES.map((s, i) => {
          const state = failed && i === at ? "failed" : i < at ? "done" : i === at ? "now" : "todo";
          return (
            <li key={s.label} className={"stage stage-" + state}>
              <span className="stage-mark" aria-hidden />
              <span className="stage-label">{s.label}</span>
              <span className="stage-note">{s.note}</span>
              {state === "now" && project.status === "transcribing" && (
                <span className="stage-pct mono">{Math.round(project.progress * 100)}%</span>
              )}
            </li>
          );
        })}
      </ol>

      {project.status === "transcribing" && (
        <span className="bar wide">
          <span className="bar-fill" style={{ width: `${project.progress * 100}%` }} />
        </span>
      )}
      {project.device === "cpu" && !failed && (
        <p className="hint">目前用 CPU 辨識(GPU 未啟用),速度會比較慢。</p>
      )}
      {project.error && <p className="error-text">{project.error}</p>}
      {failed && (
        <button className="btn" onClick={onRetry}>
          重新辨識
        </button>
      )}
    </div>
  );
}

/** 專案名。點一下就地改,Enter 存、Esc 取消。 */
function ProjectName({
  project,
  onRename,
}: {
  project: Project | null;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!project) return <span className="topbar-name" />;
  if (draft === null) {
    return (
      <button
        className="topbar-name topbar-name-btn"
        onClick={() => setDraft(project.name)}
        title="點一下改名"
      >
        {project.name}
      </button>
    );
  }
  const commit = () => {
    const name = draft.trim();
    if (name && name !== project.name) onRename(name);
    setDraft(null);
  };
  return (
    <input
      className="topbar-name topbar-name-input"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // 編輯器有一堆單鍵快速鍵,別讓打字觸發到
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

function EditorTopbar({
  project,
  saveState,
  projectId,
  exportMenuRef,
  onBurn,
  onRename,
}: {
  project: Project | null;
  saveState: SaveState;
  projectId: string;
  exportMenuRef?: React.RefObject<HTMLDetailsElement>;
  onBurn?: () => void;
  onRename?: (name: string) => void;
}) {
  const done = project?.status === "done";
  return (
    <header className="topbar">
      <a className="brand-link" href="#/" title="回專案列表">
        <Brand />
      </a>
      {onRename ? (
        <ProjectName project={project} onRename={onRename} />
      ) : (
        <span className="topbar-name">{project?.name ?? ""}</span>
      )}
      <span className="topbar-right">
        {done && (
          <span className={"save-state save-" + saveState}>{SAVE_LABEL[saveState]}</span>
        )}
        <a className="btn small" href="#/settings">
          設定
        </a>
        {done && (
          <details className="export-menu" ref={exportMenuRef}>
            <summary className="btn primary">匯出</summary>
            <div className="export-items">
              {EXPORT_FORMATS.map((f) => (
                <a
                  key={f.format}
                  href={api.exportUrl(projectId, f.format)}
                  onClick={() => {
                    if (exportMenuRef?.current) exportMenuRef.current.open = false;
                  }}
                >
                  {f.label}
                </a>
              ))}
              {onBurn && project?.has_video !== false && (
                <button
                  onClick={() => {
                    if (exportMenuRef?.current) exportMenuRef.current.open = false;
                    onBurn();
                  }}
                >
                  成品影片(燒錄字幕)
                </button>
              )}
            </div>
          </details>
        )}
      </span>
    </header>
  );
}

interface RowProps {
  seg: Segment;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  editingCursor: number | null;
  rowRef: (el: HTMLDivElement | null) => void;
  onRowClick: (index: number) => void;
  onStartEdit: (id: string, cursor: number) => void;
  onBlurCommit: (id: string, draft: string) => void;
  onEsc: (id: string, draft: string) => void;
  onSplit: (id: string, draft: string, pos: number) => void;
  onMergeUp: (id: string, draft: string) => void;
  onTab: (id: string, draft: string, dir: 1 | -1) => void;
  onDelete: (index: number) => void;
  onTransCommit: (id: string, text: string) => void;
}

const Row = memo(function Row({
  seg,
  index,
  isActive,
  isSelected,
  editingCursor,
  rowRef,
  onRowClick,
  onStartEdit,
  onBlurCommit,
  onEsc,
  onSplit,
  onMergeUp,
  onTab,
  onDelete,
  onTransCommit,
}: RowProps) {
  const cls =
    "sub-row" + (isActive ? " active" : "") + (isSelected ? " selected" : "");
  return (
    <div
      ref={rowRef}
      className={cls}
      onClick={() => onRowClick(index)}
      onDoubleClick={() => onStartEdit(seg.id, seg.text.length)}
    >
      <span
        className="row-time"
        title={`${formatTime(seg.start)} → ${formatTime(seg.end)}`}
      >
        {formatTime(seg.start)}
      </span>
      {editingCursor !== null ? (
        <RowTextarea
          segId={seg.id}
          initial={seg.text}
          cursor={editingCursor}
          onBlurCommit={onBlurCommit}
          onEsc={onEsc}
          onSplit={onSplit}
          onMergeUp={onMergeUp}
          onTab={onTab}
        />
      ) : (
        <span className="row-text">{seg.text}</span>
      )}
      <span
        className={"row-count " + speedLevel(seg)}
        title={`${seg.text.replace(/\s/g, "").length} 字 · ${readingSpeed(seg).toFixed(
          1
        )} 字寬/秒${SPEED_HINT[speedLevel(seg)]}`}
      >
        {seg.text.replace(/\s/g, "").length}
      </span>
      <button
        className="row-delete"
        title="刪除這句字幕"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(index);
        }}
      >
        ✕
      </button>
      {seg.trans !== undefined && (
        <TransInput segId={seg.id} value={seg.trans} onCommit={onTransCommit} />
      )}
    </div>
  );
});

/** 譯文那一行。翻譯本來就會想順手改字,所以直接可編輯;離開輸入框才進歷史。 */
function TransInput({
  segId,
  value,
  onCommit,
}: {
  segId: string;
  value: string;
  onCommit: (id: string, text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="row-trans"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(segId, draft)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
      aria-label="譯文"
    />
  );
}

function RowTextarea({
  segId,
  initial,
  cursor,
  onBlurCommit,
  onEsc,
  onSplit,
  onMergeUp,
  onTab,
}: {
  segId: string;
  initial: string;
  cursor: number;
  onBlurCommit: (id: string, draft: string) => void;
  onEsc: (id: string, draft: string) => void;
  onSplit: (id: string, draft: string, pos: number) => void;
  onMergeUp: (id: string, draft: string) => void;
  onTab: (id: string, draft: string, dir: 1 | -1) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoSize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const pos = Math.min(cursor, el.value.length);
    el.setSelectionRange(pos, pos);
    autoSize(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      ref={ref}
      className="row-editor"
      value={draft}
      rows={1}
      onChange={(e) => {
        setDraft(e.target.value);
        autoSize(e.target);
      }}
      onBlur={() => onBlurCommit(segId, draft)}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSplit(segId, draft, el.selectionStart);
        } else if (
          e.key === "Backspace" &&
          el.selectionStart === 0 &&
          el.selectionEnd === 0
        ) {
          e.preventDefault();
          onMergeUp(segId, draft);
        } else if (e.key === "Tab") {
          e.preventDefault();
          onTab(segId, draft, e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onEsc(segId, draft);
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
