# Yaozi 咬字

**A local-first subtitle tool.** Drop in a video → GPU speech recognition → keyboard-driven
proofreading → export SRT / transcript, or burn the subtitles straight into the final video.
Every file and every computation stays on your own machine: no cloud, no account, no subscription.

[繁體中文說明](README.zh-TW.md)

The interface is available in **English, 日本語 and 繁體中文** (Settings → Interface → Language).

## Features

- **Speech recognition** — faster-whisper (large-v3), NVIDIA GPU accelerated with an automatic
  CPU fallback. Chinese output is converted to Traditional Chinese with Taiwanese wording (OpenCC).
- **Editor** — Enter to split at the cursor, Backspace at line start to merge, Tab to move between
  lines: the whole pass can be done from the keyboard. Undo/redo, autosave, search and replace,
  per-line character count and reading-speed warnings.
- **Auto segmentation** — Whisper's fragments are glued back into sentences and over-long lines are
  split on word timestamps, preferring punctuation and then breathing pauses. Line length counts
  CJK characters and Latin letters separately, so one setting fits both. "Re-segment" applies a new
  setting to existing subtitles without re-running recognition.
- **Waveform** — drag subtitle blocks to retime, snap to neighbours / marks / detected scene cuts,
  `B` to split at the playhead, double-click to set a mark, hover to scrub.
- **Audio processing** — denoise (`afftdn`), voice band (80 Hz–8 kHz), loudness normalisation
  (EBU R128) and gain. Applied when burning in and available as a processed MP3 download;
  optionally applied before recognition for badly recorded material.
- **Word list** — a "wrong form → correct form" list applied automatically after every
  transcription, so names and jargon are fixed once and for all.
- **Translation and AI proofreading (optional)** — appears when
  [Claude Code](https://claude.com/claude-code) or the Codex CLI is detected. It uses the CLI you
  are already signed in to, so no API key is needed. Proofreading catches homophone typos and
  regional wording and is reviewed line by line as a diff — nothing is applied automatically and
  timings are never touched.
- **Import** — bring in an existing SRT / VTT file and edit or burn it here.
- **Safe area** — 16:9 / 9:16 / 4:3 / 3:4 overlays showing where platform UI covers the frame, so
  you know when to wrap a line.
- **Export** — SRT, bilingual SRT, VTT, transcript (plain or timestamped), processed audio (MP3),
  or the finished video with subtitles burned in (NVENC hardware encoding, automatic CPU fallback).

## Install

Requirements: Windows 10/11. An NVIDIA GPU makes recognition much faster but is not required.

```
git clone <this repo>
double-click setup.bat     # installs Python/ffmpeg, builds the environment, writes a health report
double-click start.bat     # starts the server and opens http://127.0.0.1:8765
```

The first transcription downloads the Whisper model (large-v3, about 3 GB; once only). An
interrupted download resumes next time. Models live in the project's `models/` folder — copy that
folder along with the project when moving to another machine and nothing needs downloading again.

The frontend is pre-built (`frontend/dist` is version-controlled), so **Node.js is not needed** for
normal use — only for working on the frontend code.

### Troubleshooting

- **Model download fails / cannot reach HuggingFace** (blocked in some regions): set a mirror
  before starting, e.g. add `set HF_ENDPOINT=https://hf-mirror.com` right after `@echo off` in
  `start.bat`.
- **macOS / Linux**: `setup.bat` and `start.bat` are Windows scripts. Elsewhere, install Python 3.13
  and ffmpeg, then `python -m venv .venv`, install `backend/requirements.lock.txt` with the venv's
  pip (the `nvidia-*` packages are only needed on Windows/Linux with an NVIDIA GPU and can be
  skipped on macOS), and run `python run.py`. The core is cross-platform, but Windows is where it
  is actually tested.

## Shutting down

Closing the **terminal window** (or pressing `Ctrl+C`) stops the server. Closing only the browser
tab leaves recognition running in the background and the progress is still there when you reopen
the page — that is deliberate.

## Shortcuts

| Key | Action |
|---|---|
| Click a line | Seek the video to it |
| Double-click / Enter | Edit the line |
| `Enter` while editing | Split at the cursor |
| `Backspace` at line start | Merge with the previous line |
| `Tab` / `Shift+Tab` | Next / previous line |
| `Space` | Play / pause |
| `↑` `↓` | Select a line and seek to it |
| `B` | Split the subtitle at the playhead |
| `N` | Jump to the next problem line |
| `Shift+click` / `Shift+↑↓` | Select a range of lines |
| `Ctrl+M` | Merge the selected lines |
| `Delete` | Delete the selected subtitles |
| Double-click the waveform | Add / remove a mark |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |

## Configuration (environment variables, can go in start.bat)

| Variable | Default | Meaning |
|---|---|---|
| `YAOZI_MODEL` | `large-v3` | Whisper model (`medium`/`small` on modest machines) |
| `YAOZI_LANG` | `auto` | Auto-detect language, or pin it to `zh`, `ja`, … |
| `YAOZI_PORT` | `8765` | Server port |
| `YAOZI_DATA` | `./projects` | Where project data is stored |
| `YAOZI_MODELS` | `./models` | Where models are stored |
| `YAOZI_FIX_MODEL` | `sonnet` | Claude model used for AI proofreading |

Language, prompt, VAD sensitivity, line length, subtitle style and audio processing are global
settings edited in the app (Settings page) and stored as JSON next to your projects.

## Development

```powershell
# backend (auto-reload)
.venv\Scripts\uvicorn backend.main:app --reload --port 8765

# frontend (dev mode, proxied to the backend)
cd frontend; npm run dev

# rebuild before using it for real
cd frontend; npm run build

# checks
cd frontend; npm run check      # TypeScript
cd frontend; npm run selfcheck  # subtitle logic + translation tables
python -m backend.test_style    # subtitle style / ASS output
python -m backend.test_audio    # audio filter chain
```

Architecture: Python FastAPI backend (faster-whisper, ffmpeg, OpenCC) + React/Vite frontend.
Project data is plain JSON under `projects/<id>/` — there is no database.
Security: the server binds to 127.0.0.1 only, with Host validation (blocks DNS rebinding) and an
Origin check (blocks CSRF).

**Translations** live in `frontend/src/locales/`. The key of every entry is the Traditional Chinese
source string, so a missing key simply shows Chinese instead of blank text. `npm run selfcheck`
fails if a `t("…")` in the code has no entry in `en.ts` and `ja.ts`, or if the `{0}` placeholders
do not match. To add a language: copy `en.ts`, translate the values, and register it in `i18n.ts`.

## Credits

Inspired by a video about What'Sub, the subtitle site built by the YouTuber
[壹加壹](https://www.youtube.com/@1plus1tw). This project is a personal local-first take on that
idea, and the interface is a nod to it.

## License

MIT
