import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadMedia } from "./api";
import Brand from "./Brand";
import { RUNNING_STATUSES, statusLabel, type Project } from "./types";
import { formatTime } from "./segments";

/** 裝飾用插圖。圖檔放 frontend/public/art/<name>.png(不能放 assets,那是 Vite 打包的目錄),
 *  還沒放的話整個元素自己消失,版面照常,不會留破圖。 */
function Illustration({ name, className }: { name: string; className: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img className={className} src={`/art/${name}.png`} alt="" onError={() => setOk(false)} />
  );
}

interface Upload {
  name: string;
  progress: number;
  error?: string;
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
  const fileInput = useRef<HTMLInputElement>(null);

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
    if (!confirm(`刪除「${p.name}」?專案裡的媒體檔和字幕都會一併刪除。`)) return;
    api.deleteProject(p.id).then(refresh).catch((e: Error) => alert(e.message));
  };

  return (
    <div className="page">
      <header className="topbar">
        <Brand />
        <span className="topbar-note">本機字幕工具,檔案不離開你的電腦</span>
        <span className="topbar-right">
          <a className="btn small" href="#/settings">
            設定
          </a>
        </span>
      </header>

      <main className="home">
        {!ffmpegOk && (
          <div className="health-banner">
            找不到 ffmpeg,辨識和匯出都無法運作——請執行專案資料夾裡的
            setup.bat 自動安裝,裝完重開伺服器。
          </div>
        )}

        {/* 怪物手上那塊字幕板就是投放區。橫幅本來只是裝飾,佔掉一整個畫面
            又什麼都不能做;把板子變成落點,同一塊空間就有了用處。 */}
        <section className="hero">
          <div className="hero-copy">
            <h1 className="hero-title">
              打字幕
              <br />
              不該比剪片久
            </h1>
            <p className="hero-sub">
              自動聽打、鍵盤校對、匯出 SRT 或直接把字幕燒進成品。
              全程在這台電腦上跑,不上傳、不需要帳號。
            </p>
          </div>
          {/* 投放區用「圖片百分比」定位,所以外面這層必須跟圖片一樣的比例,
              不然換個視窗寬度板子就跑掉了 */}
          <div className="hero-stage">
            <Illustration name="banner" className="hero-bg" />
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
              <span className="hero-drop-title">把影片或音檔丟進來</span>
              <span className="hero-drop-sub">或點一下選擇檔案,放開就開始辨識</span>
            </button>
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
              <span className="url-label">或貼網址</span>
              <input
                className="url-input"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                aria-label="影片網址"
                disabled={!ytOk}
              />
              <button
                className="btn primary"
                type="submit"
                disabled={!ytOk || !url.trim() || urlBusy}
              >
                {urlBusy ? "讀取中…" : "下載並辨識"}
              </button>
            </form>
            {!ytOk && (
              <p className="url-missing">
                這台電腦的環境裡沒有 yt-dlp,貼網址下載暫時不能用。跑一次專案資料夾裡的
                setup.bat 就會補裝(或自己下 <code>.venv\Scripts\pip install yt-dlp</code>),
                裝完重開伺服器。
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
                      知道了
                    </button>
                  </span>
                ) : (
                  <span className="upload-progress">
                    <span className="bar">
                      <span className="bar-fill" style={{ width: `${u.progress * 100}%` }} />
                    </span>
                    上傳中 {Math.round(u.progress * 100)}%
                  </span>
                )}
              </div>
            ))}
          </section>
        )}

        {projects === null ? (
          <p className="empty-hint">載入中…</p>
        ) : projects.length === 0 && uploads.length === 0 ? (
          <div className="empty-state">
            <Illustration name="empty" className="empty-art" />
            <p className="empty-hint">還沒有專案。丟一支影片進來,一兩分鐘後就有逐字稿。</p>
          </div>
        ) : (
          <section className="project-grid">
            {projects.map((p) => {
              const running = RUNNING_STATUSES.includes(p.status);
              return (
                <a key={p.id} className="project-card" href={`#/p/${p.id}`}>
                  <div className="project-name">{p.name}</div>
                  <div className="project-meta">
                    <span className="mono">
                      {p.duration ? formatTime(p.duration) : "--:--"}
                    </span>
                    <span>{new Date(p.created_at * 1000).toLocaleDateString("zh-TW")}</span>
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
                    title="刪除專案"
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
          </section>
        )}

        <section className="mascot">
          <div className="mascot-copy">
            <p className="mascot-kicker">全程離線</p>
            <h2 className="mascot-title">
              你的影片
              <br />
              不會被餵去訓練誰
            </h2>
            <p className="mascot-sub">
              辨識、校對、燒錄都在這台電腦跑完。沒有上傳、沒有帳號、沒有月費。
            </p>
            <div className="mascot-tags">
              <span>faster-whisper large-v3</span>
              <span>本機 GPU 加速</span>
              <span>檔案留在硬碟裡</span>
            </div>
          </div>
          <Illustration name="offline" className="mascot-art" />
        </section>
      </main>
    </div>
  );
}
