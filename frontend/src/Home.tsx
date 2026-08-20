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
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getHealth()
      .then((h) => setFfmpegOk(h.ffmpeg))
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

        <section className="hero">
          <div className="hero-copy">
            <h1 className="hero-title">
              打字幕
              <br />
              不該比剪片久
            </h1>
            <p className="hero-sub">
              丟一支影片進來,自動聽打、鍵盤校對、匯出 SRT 或直接把字幕燒進成品。
              全程在這台電腦上跑,不上傳、不需要帳號。
            </p>
          </div>
          <Illustration name="hero" className="hero-art" />
        </section>

        <div
          className={"dropzone" + (dragging ? " dragging" : "")}
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
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
          }}
        >
          <div className="dropzone-title">把影片或音檔丟進來</div>
          <div className="dropzone-sub">或點一下選擇檔案,放開就開始辨識</div>
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
        </div>

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
          </div>
          <Illustration name="mascot" className="mascot-art" />
        </section>
      </main>
    </div>
  );
}
