import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { FontGroup } from "./types";
import { t } from "./i18n";

/** 字型選單。原本用 <datalist>,Chrome 只有在打字時才掉清單、常常整個不出現,
 *  所以改成自己畫的下拉:一打開就看得到全部字型,而且每個項目用它自己的字型渲染。
 *
 *  清單是後端列舉的「系統已安裝字型」,依語系分組(中文在最上面)。同一個家族名
 *  瀏覽器與 libass 都認得,所以這裡預覽到的字就是燒出來的字。
 */

let cache: FontGroup[] | null = null;

/** 本地化家族名 → 英文家族名。清單還沒回來之前是空的,fontStack() 就只吐原名。 */
const alias = new Map<string, string>();

const injected = new Set<string>();
const quote = (s: string) => `"${s.replace(/["\\]/g, "\\$&")}"`;
const BUNDLED_FONTS = new Set(["俐方體11號"]);
const webFamily = (font: string) => `Yaozi Web ${font}`;

/** 幫選中的系統字型補一份 @font-face，直接從後端讀實際檔案。
 *
 *  Windows 一個字型有好幾種名字(GDI 家族名、排版家族名、PostScript 名),瀏覽器只認
 *  其中一種,對不上就默默掉回系統預設字——這台機器 424 個字型有 116 個是這樣,使用者
 *  看到的就是「選了沒反應」。讀檔案沒有這層不確定性。
 *
 *  @font-face 使用獨立的 Yaozi Web 名稱，不能再用原家族名：預設俐方體已經有一條
 *  指向 repo 內字型的規則，同名動態規則若 API 失敗會把正確規則蓋掉。
 *
 *  只對真的套用了的字型做。選單裡幾百個項目每個都下載一份字型檔太誇張。 */
function ensureFontFile(font: string): void {
  if (BUNDLED_FONTS.has(font) || injected.has(font)) return;
  injected.add(font);
  const el = document.createElement("style");
  el.dataset.yaoziFont = font;
  el.textContent = `@font-face{font-family:${quote(webFamily(font))};src:url("/api/fontfile?name=${encodeURIComponent(font)}");font-display:swap}`;
  document.head.appendChild(el);
}

/** 字型名稱轉成 CSS 的 font-family 值,順便確保這個字型掛得上去。
 *  空字串代表「不指定」,交給呼叫端決定。 */
export function fontStack(font: string): string {
  if (!font) return "";
  ensureFontFile(font);
  const en = alias.get(font);
  const names = BUNDLED_FONTS.has(font) ? [font] : [webFamily(font), font];
  if (en && en !== font) names.push(en);
  return names.map(quote).join(", ");
}

/** 字型清單整個 app 共用一份,開幾次面板都只打一次 API。
 *  App 最外層也呼叫一次:清單一回來整棵樹重畫,fontStack() 才會補上英文名。 */
export function useFontGroups(): FontGroup[] {
  const [groups, setGroups] = useState<FontGroup[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    api
      .getFonts()
      .then((r) => {
        cache = r.groups;
        for (const g of r.groups) {
          for (const f of g.fonts) if (f.en) alias.set(f.name, f.en);
        }
        setGroups(r.groups);
      })
      .catch(() => {});
  }, []);
  return groups;
}

export default function FontPicker({
  value,
  onChange,
  placeholder = t("系統預設"),
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
      .map((g) => ({
        // 英文名也吃搜尋:打 "gensen" 找得到「源泉圓體丹」
        ...g,
        fonts: g.fonts.filter(
          (f) => f.name.toLowerCase().includes(q) || f.en?.toLowerCase().includes(q)
        ),
      }))
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
        style={value ? { fontFamily: fontStack(value) } : undefined}
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
            placeholder={t("搜尋字型…")}
            aria-label={t("搜尋字型")}
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
                    key={f.name}
                    type="button"
                    className={"fontpick-item" + (f.name === value ? " on" : "")}
                    style={{ fontFamily: f.en ? `"${f.name}", "${f.en}"` : `"${f.name}"` }}
                    onClick={() => pick(f.name)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            ))}
            {!shown.length && <div className="fontpick-empty">{t("找不到符合的字型")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
