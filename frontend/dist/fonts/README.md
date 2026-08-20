# 附在 repo 裡的字型

## Cubic_11.ttf（俐方體11號）

- 作者：ACh-K（Cubic 11 / 俐方體11號）
- 來源：<https://github.com/ACh-K/Cubic-11>
- 授權：SIL Open Font License 1.1

拿來當介面的預設字型。之所以不靠「使用者自己裝」：

Windows 的 GDI 回報的家族名是本地化的「俐方體11號」，字型檔 name table 裡的
英文家族名卻是 `Cubic 11`。字型選單列出來的是前者，瀏覽器不見得認，選了以後
就默默掉回系統字——看起來就像「選了沒反應」。直接 `@font-face` 讀 repo 裡這份，
就沒有這層對不上的問題（`styles.css` 最上面）。

> TODO：OFL 1.1 要求散布時附上完整授權條文，請從上面的 repo 抓一份 `OFL.txt`
> 放到這個資料夾。
