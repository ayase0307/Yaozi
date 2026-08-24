import { t } from "./i18n";
/** 設定項目下面那段說明。預設收起來——每一項都掛 2~4 行的話,
 *  整頁要捲很久才找得到要改的那一格。 */
export default function Hint({ children }: { children: React.ReactNode }) {
  return (
    <details className="style-hint">
      <summary>{t("這是什麼")}</summary>
      <div className="style-hint-body">{children}</div>
    </details>
  );
}
