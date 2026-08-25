import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, uploadMedia } from "./api";
import Brand from "./Brand";
import { RUNNING_STATUSES, statusLabel, type Project } from "./types";
import { formatTime } from "./segments";
import { lang, t } from "./i18n";

/** 載不到就自己消失的圖。插圖檔放 frontend/public/art/(不能放 assets,那是 Vite 打包的目錄);
 *  專案縮圖也走這裡——純音檔的 /thumb 會回 404,消失剛好就是要的行為。 */
function Img({ src, className }: { src: string; className: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setOk(false)} />;
}

interface Upload {
  name: string;
  progress: number;
  error?: string;
}

type ProjectFilter = "all" | "running" | "done" | "attention";
type ProjectSort = "recent" | "name" | "duration";

const PROJECT_FILTERS: { key: ProjectFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "running", label: "處理中" },
  { key: "done", label: "已完成" },
  { key: "attention", label: "需處理" },
];

function projectMatchesFilter(project: Project, filter: ProjectFilter): boolean {
  if (filter === "running") return RUNNING_STATUSES.includes(project.status);
  if (filter === "done") return project.status === "done";
  if (filter === "attention") return project.status === "error" || project.status === "interrupted";
  return true;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [ffmpegOk, setFfmpegOk] = useState(true);
  // null = 還沒問到。沒有 yt-dlp 時要照樣把欄位畫出來、只是停用,
  // 整塊消失只會讓人以為功能被拿掉了(之前就是這樣)。
  const [ytOk, setYtOk] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [projectSort, setProjectSort] = useState<ProjectSort>(() => {
    const stored = localStorage.getItem("yaozi:project-sort");
    return stored === "name" || stored === "duration" ? stored : "recent";
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const projectSearchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getHealth()
      .then((h) => setFfmpegOk(h.ffmpeg))
      .catch(() => {});
    api
      .getLlmStatus()
      .then((s) => setYtOk(s.yt_dlp))
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem("yaozi:project-sort", projectSort);
  }, [projectSort]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        projectSearchInput.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === projectSearchInput.current) {
        setProjectQuery("");
        projectSearchInput.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const projectCounts = useMemo(() => {
    const list = projects ?? [];
    return {
      all: list.length,
      running: list.filter((project) => RUNNING_STATUSES.includes(project.status)).length,
      done: list.filter((project) => project.status === "done").length,
      attention: list.filter(
        (project) => project.status === "error" || project.status === "interrupted"
      ).length,
    };
  }, [projects]);

  const visibleProjects = useMemo(() => {
    const normalizedQuery = projectQuery.trim().toLocaleLowerCase("zh-TW");
    const list = (projects ?? []).filter((project) => {
      const matchesQuery =
        !normalizedQuery || project.name.toLocaleLowerCase("zh-TW").includes(normalizedQuery);
      return matchesQuery && projectMatchesFilter(project, projectFilter);
    });
    return list.sort((a, b) => {
      if (projectSort === "name") return a.name.localeCompare(b.name, "zh-Hant");
      if (projectSort === "duration") return (b.duration ?? -1) - (a.duration ?? -1);
      return b.created_at - a.created_at;
    });
  }, [projectFilter, projectQuery, projectSort, projects]);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const entry: Upload = { name: file.name, progress: 0 };
        setUploads((u) => [...u, entry]);
        uploadMedia(file, (ratio) => {
          setUploads((u) => u.map((x) => (x === entry ? { ...x, progress: ratio } : x)));
        })
          .then(() => {
            setUploads((u) => u.filter((x) => x !== entry));
            refresh();
          })
          .catch((err: Error) => {
            setUploads((u) => u.map((x) => (x === entry ? { ...x, error: err.message } : x)));
          });
      }
    },
    [refresh]
  );

  const submitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const link = url.trim();
    if (!link || urlBusy) return;
    setUrlBusy(true);
    api
      .createFromUrl(link)
      .then(() => {
        setUrl("");
        refresh();
      })
      .catch((err: Error) => alert(err.message))
      .finally(() => setUrlBusy(false));
  };

  const deleteProject = (p: Project) => {
    if (!confirm(t("刪除「{0}」?專案裡的媒體檔和字幕都會一併刪除。", p.name))) return;
    api.deleteProject(p.id).then(refresh).catch((e: Error) => alert(e.message));
  };

  return (
    <div className="page">
      <header className="topbar">
        <Brand />
        <span className="topbar-note">{t("本機字幕工具,檔案不離開你的電腦")}</span>
        <span className="topbar-right">
          <a className="btn small" href="#/settings">
            {t("設定")}
          </a>
        </span>
      </header>

      <main className="home">
        {!ffmpegOk && (
          <div className="health-banner">
            {t("找不到 ffmpeg,辨識和匯出都無法運作——請執行專案資料夾裡的 setup.bat 自動安裝,裝完重開伺服器。")}
          </div>
        )}

        {/* 怪物手上那塊字幕板就是投放區。橫幅本來只是裝飾,佔掉一整個畫面
            又什麼都不能做;把板子變成落點,同一塊空間就有了用處。 */}
        <section className="hero">
          <div className="hero-copy">
            <h1 className="hero-title">
              {t("打字幕")}
              <br />
              {t("不該比剪片久")}
            </h1>
            <p className="hero-sub">
              {t("自動聽打、鍵盤校對、匯出 SRT 或直接把字幕燒進成品。全程在這台電腦上跑,不上傳、不需要帳號。")}
            </p>
          </div>
          {/* 投放區用「圖片百分比」定位,所以外面這層必須跟圖片一樣的比例,
              不然換個視窗寬度板子就跑掉了 */}
          <div className="hero-stage">
            <Img src="/art/banner.png" className="hero-bg" />
            <button
              type="button"
              className={"hero-drop" + (dragging ? " dragging" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInput.current?.click()}
            >
              <span className="hero-drop-title">{t("把影片或音檔丟進來")}</span>
              <span className="hero-drop-sub">{t("或點一下選擇檔案,放開就開始辨識")}</span>
            </button>
            {/* 同一張圖疊在投放區上面,只露出兩隻拳頭 —— 板子就藏到手的後面去了 */}
            <Img src="/art/banner.png" className="hero-fg" />
          </div>
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            accept="video/*,audio/*,.mkv,.mts,.m2ts"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </section>

        {ytOk !== null && (
          <>
            <form className="url-form" onSubmit={submitUrl}>
              <span className="url-label">{t("或貼網址")}</span>
              <input
                className="url-input"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                aria-label={t("影片網址")}
                disabled={!ytOk}
              />
              <button
                className="btn primary"
                type="submit"
                disabled={!ytOk || !url.trim() || urlBusy}
              >
                {urlBusy ? t("讀取中…") : t("下載並辨識")}
              </button>
            </form>
            {!ytOk && (
              <p className="url-missing">
                {t("這台電腦的環境裡沒有 yt-dlp,貼網址下載暫時不能用。跑一次專案資料夾裡的 setup.bat 就會補裝(或自己下")} <code>.venv\Scripts\pip install yt-dlp</code>{t("), 裝完重開伺服器。")}
              </p>
            )}
          </>
        )}

        {uploads.length > 0 && (
          <section className="upload-list">
            {uploads.map((u, i) => (
              <div key={i} className={"upload-item" + (u.error ? " failed" : "")}>
                <span className="upload-name">{u.name}</span>
                {u.error ? (
                  <span className="upload-error">
                    {u.error}
                    <button
                      className="link-btn"
                      onClick={() => setUploads((list) => list.filter((x) => x !== u))}
                    >
                      {t("知道了")}
                    </button>
                  </span>
                ) : (
                  <span className="upload-progress">
                    <span className="bar">
                      <span className="bar-fill" style={{ width: `${u.progress * 100}%` }} />
                    </span>
                    {t("上傳中")} {Math.round(u.progress * 100)}%
                  </span>
                )}
              </div>
            ))}
          </section>
        )}

        {projects === null ? (
          <p className="empty-hint">{t("載入中…")}</p>
        ) : projects.length === 0 && uploads.length === 0 ? (
          <div className="empty-state">
            <Img src="/art/empty.png" className="empty-art" />
            <p className="empty-hint">{t("還沒有專案。丟一支影片進來,一兩分鐘後就有逐字稿。")}</p>
          </div>
        ) : projects.length > 0 ? (
          <section className="project-library" aria-labelledby="project-library-title">
            <header className="library-head">
              <div>
                <p className="library-kicker">PROJECT LIBRARY</p>
                <h2 id="project-library-title">{t("繼續上次的進度")}</h2>
              </div>
              <p className="library-summary">
                <strong>{projectCounts.done}</strong> {t("個完成")}
                {projectCounts.running > 0 && (
                  <span> · {projectCounts.running} {t("個處理中")}</span>
                )}
              </p>
            </header>

            <div className="library-controls">
              <label className="project-search">
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
                  <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <input
                  ref={projectSearchInput}
                  value={projectQuery}
                  onChange={(event) => setProjectQuery(event.target.value)}
                  placeholder={t("搜尋專案名稱")}
                  aria-label={t("搜尋專案名稱")}
                />
                {projectQuery ? (
                  <button type="button" onClick={() => setProjectQuery("")} aria-label={t("清除搜尋")}>
                    ×
                  </button>
                ) : (
                  <kbd>/</kbd>
                )}
              </label>

              <div className="project-filters" role="group" aria-label={t("專案狀態篩選")}>
                {PROJECT_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={projectFilter === filter.key ? "on" : ""}
                    aria-pressed={projectFilter === filter.key}
                    onClick={() => setProjectFilter(filter.key)}
                  >
                    {t(filter.label)}
                    <span>{projectCounts[filter.key]}</span>
                  </button>
                ))}
              </div>

              <label className="project-sort">
                <span>{t("排序")}</span>
                <select
                  value={projectSort}
                  onChange={(event) => setProjectSort(event.target.value as ProjectSort)}
                  aria-label={t("專案排序")}
                >
                  <option value="recent">{t("最近建立")}</option>
                  <option value="name">{t("名稱")}</option>
                  <option value="duration">{t("影片長度")}</option>
                </select>
              </label>
            </div>

            {visibleProjects.length === 0 ? (
              <div className="library-empty">
                <span>{t("沒有符合條件的專案")}</span>
                <button
                  className="link-btn"
                  onClick={() => {
                    setProjectQuery("");
                    setProjectFilter("all");
                  }}
                >
                  {t("清除篩選")}
                </button>
              </div>
            ) : (
              <div className="project-grid">
                {visibleProjects.map((p) => {
                  const running = RUNNING_STATUSES.includes(p.status);
                  return (
                    <a key={p.id} className="project-card" href={`#/p/${p.id}`}>
                      {/* 還在跑的專案不去要縮圖:媒體檔可能還在寫,而且抽一張圖要搶 ffmpeg */}
                      {!running && (
                        <Img src={`/api/projects/${p.id}/thumb`} className="card-thumb" />
                      )}
                      <div className="project-name">{p.name}</div>
                      <div className="project-meta">
                        <span className="mono">
                          {p.duration ? formatTime(p.duration) : "--:--"}
                        </span>
                        {p.seg_count ? (
                          <span className="mono">{p.seg_count} {t("句")}</span>
                        ) : null}
                        <span>{new Date(p.created_at * 1000).toLocaleDateString(lang)}</span>
                      </div>
                      <div className="project-status">
                        {running && <span className="spinner" aria-hidden />}
                        <span className={"status-text status-" + p.status}>{statusLabel(p)}</span>
                      </div>
                      {p.status === "transcribing" && (
                        <span className="bar card-bar">
                          <span className="bar-fill" style={{ width: `${p.progress * 100}%` }} />
                        </span>
                      )}
                      <button
                        className="card-delete"
                        title={t("刪除專案")}
                        onClick={(e) => {
                          e.preventDefault();
                          deleteProject(p);
                        }}
                      >
                        ✕
                      </button>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        <section className="mascot">
          <div className="mascot-copy">
            <p className="mascot-kicker">{t("全程離線")}</p>
            <h2 className="mascot-title">
              {t("你的影片")}
              <br />
              {t("不會被餵去訓練誰")}
            </h2>
            <p className="mascot-sub">
              {t("辨識、校對、燒錄都在這台電腦跑完。沒有上傳、沒有帳號、沒有月費。")}
            </p>
            <div className="mascot-tags">
              <span>faster-whisper large-v3</span>
              <span>{t("本機 GPU 加速")}</span>
              <span>{t("檔案留在硬碟裡")}</span>
            </div>
          </div>
          <Img src="/art/offline.png" className="mascot-art" />
        </section>
      </main>
    </div>
  );
}
