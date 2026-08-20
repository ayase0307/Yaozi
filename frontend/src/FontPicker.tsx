import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { FontGroup } from "./types";

/** 字型選單。原本用 <datalist>,Chrome 只有在打字時才掉清單、常常整個不出現,
 *  所以改成自己畫的下拉:一打開就看得到全部字型,而且每個項目用它自己的字型渲染。
 *
 *  清單是後端列舉的「系統已安裝字型」,依語系分組(中文在最上面)。同一個家族名
 *  瀏覽器與 libass 都認得,所以這裡預覽到的字就是燒出來的字。
 */

let cache: FontGroup[] | null = null;

/** 字型清單整個 app 共用一份,開幾次面板都只打一次 API。 */
export function useFontGroups(): FontGroup[] {
  const [groups, setGroups] = useState<FontGroup[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    api
      .getFonts()
      .then((r) => {
        cache = r.groups;
        setGroups(r.groups);
      })
      .catch(() => {});
  }, []);
  return groups;
}

export default function FontPicker({
  value,
  onChange,
  placeholder = "系統預設",
}: {
  value: string;
  onChange: (font: string) => void;
  /** 選「不指定」時顯示的字樣;不給 placeholder 就代表這個欄位一定要選一個 */
  placeholder?: string;
}) {
  const groups = useFontGroups();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, fonts: g.fonts.filter((f) => f.toLowerCase().includes(q)) }))
      .filter((g) => g.fonts.length);
  }, [groups, query]);

  const pick = (font: string) => {
    onChange(font);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="fontpick" ref={box}>
      <button
        type="button"
        className="fontpick-btn"
        style={value ? { fontFamily: `"${value}"` } : undefined}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="fontpick-name">{value || placeholder}</span>
        <span className="fontpick-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="fontpick-pop">
          <input
            className="fontpick-search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋字型…"
            aria-label="搜尋字型"
          />
          <div className="fontpick-list">
            {placeholder && (
              <button type="button" className="fontpick-item" onClick={() => pick("")}>
                {placeholder}
              </button>
            )}
            {shown.map((g) => (
              <div key={g.label}>
                <div className="fontpick-group">
                  {g.label}
                  <span className="fontpick-count">{g.fonts.length}</span>
                </div>
                {g.fonts.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={"fontpick-item" + (f === value ? " on" : "")}
                    style={{ fontFamily: `"${f}"` }}
                    onClick={() => pick(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            ))}
            {!shown.length && <div className="fontpick-empty">找不到符合的字型</div>}
          </div>
        </div>
      )}
    </div>
  );
}
