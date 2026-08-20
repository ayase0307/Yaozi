# 插圖放這裡

把 PNG（去背、建議寬邊 1200px 以上）丟進這個資料夾，檔名要對得上：

| 檔名 | 用在哪 | 建議比例 |
|---|---|---|
| `banner.png` | 首頁最上面的整條橫幅**背景**（不去背，滿版出血） | 橫式 21:9，寬 2400px 以上 |
| `empty.png` | 還沒有任何專案時的空狀態 | 約 1:1，去背 |
| `offline.png` | 首頁下方「全程離線」深綠區塊的右半邊 | 約 4:3 或 1:1，去背 |

橫幅是背景圖，主體要偏右（左邊會被文字遮罩壓暗），左三分之一留空或留暗部。

放完要重新建置前端才會進到 `dist`：

```
cd frontend
npm run build
```

檔案沒放也沒關係——找不到圖時該元素會自動隱藏，版面照常。

---

## 生圖提示詞

共通：主色 `#38d321`（螢光綠）/ `#1da50f`（深綠）/ `#0b2705`（墨綠），底色米白 `#f4f4f1`。
風格走**平面向量 + 粗描邊 + 幾何塊面**，不要 3D 渲染、不要漸層光暈、不要科技藍。
**畫面裡不要出現任何文字或字母**（會跟網頁標題打架）。

### banner.png — 首頁橫幅（21:9，寬 2400px 以上，不去背）

> A wide 21:9 flat vector illustration banner. A huge friendly one-eyed creature
> made of stacked geometric blocks bursts out of the right half of the frame,
> body cropped by the canvas edge so it feels too big to fit. It grips a giant
> subtitle bar in both hands — a simple rounded rectangle with a black outline
> and three blank white stripes inside, no readable text. Its single big eye
> looks straight at the viewer. Colour palette strictly: vivid green #38d321
> for the creature, deep green #0b2705 for outlines and shadow shapes, off-white
> #f4f4f1 background, one small red #e0403f accent. Bold uniform black outlines,
> flat fills, chunky poster-print feeling, subtle halftone dot texture. The left
> third of the image is nearly empty — just flat background and soft dark shapes
> — reserved for overlaid headline text. No text, no letters, no logos.
> Aspect ratio 21:9, 2400x1030px or larger.

要點：**主體必須偏右**，左三分之一要空（那塊會被暗色遮罩加標題壓過去）。
生出來如果主體置中，就補一句 "move the creature further right, leave the left 40% empty"。

### offline.png —「全程離線」深綠區塊右半（4:3 或 1:1，去背）

底色是深綠色塊，所以主體要用**亮綠 + 米白**，深色細節會糊掉。

> A flat vector illustration on a transparent background. A chunky closed
> padlock shaped like a desktop computer tower, its screen face replaced by a
> single calm sleeping eye. Thick cables coming out of the back are cut short
> and curl into loose spirals that go nowhere — nothing connects outward.
> A small satellite dish beside it is unplugged and tipped over. Rendered in
> off-white #f4f4f1 and vivid green #38d321 with bold outlines, flat fills,
> no gradients, no glow. Designed to sit on a very dark green background, so
> keep every shape light and high-contrast. Slight halftone texture. Playful,
> confident, poster-like. No text, no letters, no logos.
> Square-ish composition, 1200x1200px, transparent PNG.

備用方向（不想用鎖的話）：抱著硬碟睡著的圓胖生物，或一台把網路線打成蝴蝶結的電腦。
