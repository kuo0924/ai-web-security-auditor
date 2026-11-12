# 元件規格

依據：`recon.md` 的元件清單、`replica/screens/` 的商店截圖（只當參考），以及 `fixes.md`。
Token 名稱見 `tokens.json`。元件只用角色名（`theme.color.keep`），不寫死 hex。

## 全域規則

- **字體**：系統字。iOS 是 SF Pro，支援 Dynamic Type；Android 是 Roboto，跟隨系統字級。
  所有文字 `allowFontScaling` 開著，版面要撐得住 1.3 倍字級。照片上的大字章（stamp）上限 1.2 倍。
- **圖示**：
  - iOS 用 **SF Symbols**（`expo-symbols`）。
  - Android 用 **Material Symbols**（`@expo/vector-icons` 的 `MaterialCommunityIcons`）。
  - **不能在 Android 用 SF Symbols**：Apple 的授權只允許在 Apple 平台使用。
  - 元件一律呼叫 `<Icon name="keep" />`，用語意名稱，對照表在 `src/ui/Icon.tsx`。
- **深色模式**：跟隨系統（`useColorScheme`）。滑動頁和比較頁一律用 `photo-backdrop`（黑）當背景，因為照片在黑底上最好判斷。
- **最小點擊區域**：44pt；Android 48dp，不夠就用 `hitSlop` 補。
- **減少動態效果**：系統開了「減少動態效果」時，卡片飛出改成淡出，慶祝動畫改成靜態。
- **觸覺回饋**：拖過門檻時給一次 `selection`；放手成立時給 `impactLight`；清空封存區成功時給 `notificationSuccess`。
- **不用的東西**：原版的螢光黃綠強調色、天空背景、它的圖示和插圖、它的文案。

## 圖示對照（`Icon`）

| 語意 | iOS SF Symbol | Android Material |
| --- | --- | --- |
| keep | `heart.fill` | `heart` |
| delete | `trash.fill` | `delete` |
| hide | `eye.slash.fill` | `eye-off` |
| undo | `arrow.uturn.backward` | `undo` |
| favorite | `star.fill` | `star` |
| close | `xmark` | `close` |
| check | `checkmark` | `check` |
| trash-bin | `trash` | `delete-outline` |
| lock | `lock.fill` | `lock` |
| photos | `photo.on.rectangle` | `image-multiple` |
| settings | `gearshape` | `cog-outline` |
| compare | `square.split.2x1` | `compare` |
| info | `info.circle` | `information-outline` |
| restore | `arrow.counterclockwise` | `restore` |

---

## Button

```
variants  primary（accent）、keep、delete、hide、secondary（surface + border）、ghost（純文字）
sizes     md 48、lg 56（主要行動，例如「清空封存區」）
states    default、pressed（不透明度 .85 + 縮 .98）、focus-visible（2px accent 外框，鍵盤／切換控制）、
          disabled（不透明度 .4，不能點）、loading（轉圈＋保留文字給讀屏）
tokens    bg 對應角色、文字 on-角色、radius pill、字 headline
a11y      accessibilityRole="button"；loading 時 accessibilityState={{busy:true}}，label 不變
used on   S02、S04、S07、S09、S11、S15、S16
```

## IconButton

```
variants  filled（surface-raised）、overlay（照片上方：黑 45% 半透明＋on-photo 圖示）、tinted（角色色 15% 底＋角色色圖示）
sizes     44（工具列）、64（滑動頁下方三顆：刪除／復原／保留）
states    default、pressed、disabled（復原沒得復原時）、focus-visible
a11y      一定要有 accessibilityLabel（例如「刪除這張照片」），不能只有圖示
used on   S06、S08、S09、S15
```

## Icon

```
props     name（語意名，見上表）、size、color（角色名）
行為       iOS → SymbolView；Android／web → MaterialCommunityIcons
a11y      純裝飾時 accessibilityElementsHidden；有意義時由外層元件提供 label
```

## SwipeCard（核心）

```
內容        照片（expo-image，contentFit=contain，黑底）、右上角日期、可選的 Live Photo／影片標記
手勢        右滑 = 保留、左滑 = 刪除、往上 = 隱藏（門檻見 tokens.swipe）；方向集中在 SWIPE_MAP
動態        拖曳時依水平距離旋轉（最多 12°）；放手未過門檻 → spring 彈回；過門檻 → 飛出（base 220ms）
            往上：不旋轉，只往上飛並縮小到 .9
狀態        idle、dragging-keep、dragging-delete、dragging-hide、flying、loading（縮圖還沒好，顯示骨架）、
            error（讀不到照片：圖示＋「無法載入，跳過」）
疊層        DecisionStamp（見下）
tokens      radius card、背景 photo-backdrop、shadow card
a11y        讀屏使用者沒辦法滑：卡片提供 accessibilityActions = 保留／刪除／隱藏，
            下方按鈕列也能完成所有動作；照片 label = 拍攝日期＋「照片 3／120」
效能        下一張先墊在後面（縮 .94）；只掛 2 張卡片；縮圖預載接下來 5 張
used on     S06
```

## DecisionStamp（拖曳時的「保留／刪除／隱藏」字章）

```
variants  keep（左上，-12°）、delete（右上，+12°）、hide（中上，0°）
外觀       實心角色色膠囊＋on-角色文字＋圖示（不用描邊字，保證對比 ≥ 4.5）
          底下同時鋪一層角色色 0→20% 的半透明色罩，隨拖曳距離漸顯
不透明度    0 → 1，跟著距離 / 門檻
a11y      不唸（讀屏走 accessibilityActions）
used on   S06
```

## ActionBar（滑動頁下方）

```
排列       刪除（左）· 隱藏（小，中左）· 復原（小，中右）· 保留（右）——跟手勢方向一致
狀態       沒有卡片時全部 disabled；復原沒紀錄時 disabled
used on   S06
```

## UndoToast

```
內容       「已刪除 1 張 · 復原」或「已隱藏 · 復原」
行為       動作後出現 4 秒；同一時間只有一個；按「復原」→ 卡片從原方向飛回來
位置       ActionBar 上方，避開系統手勢區
a11y      出現時用 AccessibilityInfo.announceForAccessibility 唸出來
used on   S06
```

## ProgressHeader（滑動頁上方）

```
內容       月份標題（例如「2024 年 3 月」）＋「38 / 120」＋細進度條；右上封存區按鈕＋數字徽章
tokens    文字 on-photo、進度條 accent、徽章 badge / on-badge
a11y      「2024 年 3 月，已整理 38 張，共 120 張」
used on   S06
```

## Badge

```
variants  count（封存區張數，99+）、dot
tokens    badge / on-badge，字 caption（≥ 12，粗體）
used on   S05、S06
```

## SectionCard（月份分區）

```
內容       月份、張數、進度條、縮圖 3 張、狀態文字
狀態       未開始、進行中（進度條）、完成（✓＋「省下約 1.2 GB」）、空（這個月沒照片 → 不顯示）
a11y      整張卡片是一個按鈕，label =「2024 年 3 月，120 張，已整理 38 張」
used on   S05
```

## ThumbGrid / ThumbTile

```
欄數       手機 3 欄、平板 5 欄；間距 4
tile 狀態  一般、已選（accent 3px 框＋右上 ✓）、載入中（骨架）、讀不到（圖示）、影片（右下時長）
操作       點一下選取；長按預覽
a11y      每格 label = 日期＋類型；選取狀態用 accessibilityState.selected
used on   S09、S15
```

## CompareViewer（相似照片）

```
版面       兩張並排（直式），下方一行資訊（★ 建議保留 · 日期 · 檔案大小），再下面縮圖列（整組）
操作       點照片 = 選這張保留／取消；「保留選取、其他刪除」主按鈕
          ✓ 完成後**自動跳下一組**（fixes F6）；比較中**關閉卡片滑動手勢**，避免誤觸（fixes F6）
狀態       分析中（進度）、沒有相似照片（空狀態）、一組、最後一組完成
a11y      每張照片是 toggle 按鈕，label 包含「建議保留」
used on   S08
```

## PermissionBanner（部分存取）

```
內容       info 圖示＋「目前只允許讀取部分照片」＋「選更多」
行為       「選更多」→ BottomSheet：再多選幾張／允許存取全部照片＋一句說明（同 Flutter 原型 BUG-002 的修正）
used on   S06、S05
```

## PermissionScreen（拒絕）

```
內容       圖示、標題「需要相簿權限才能整理照片」、說明（照片不上傳）、
          「允許存取相簿」（primary）、「前往設定」（secondary）、沒跳視窗時的提示
a11y      標題用 accessibilityRole="header"
used on   S02
```

## BottomSheet

```
用途       選更多、設定、刪除方式說明
外觀       surface-raised、上方圓角 lg、拖曳把手、背景 scrim 黑 40%
a11y      開啟時焦點移進去；關閉時回到觸發的按鈕；Android 返回鍵關閉
used on   S06、S09
```

## ConfirmSheet（清空封存區前的 App 內確認）

```
內容       「移除 N 張照片（約 X GB）？」＋說明會進「最近刪除／系統垃圾桶，30 天內可救回」＋
          「接下來系統會再問一次，請按允許」
按鈕       「移除」（delete）、「取消」（ghost）
原因       系統視窗只寫「允許刪除 N 張？」，使用者常看不懂；先在 App 內講清楚（fixes F4）
used on   S09 → S10
```

## CelebrationSheet（清空完成）

```
內容       stat 大數字「約 2.4 GB」、「已移到最近刪除／系統垃圾桶，N 張」、30 天說明、「繼續整理」
動態       數字從 0 跑到結果（slow 360ms）；減少動態效果時直接顯示
注意       寫「將釋放約 X GB」，不寫「已釋放」（architecture §4.4）
used on   S11
```

## EmptyState

```
variants  全部整理完、封存區是空的、沒有相似照片、相簿沒有照片、上鎖相簿是空的
內容       圖示、標題、一句說明、最多一個按鈕
used on   S05、S06、S08、S09、S15
```

## UnlockGate（上鎖相簿）

```
內容       鎖圖示、「用指紋或臉部解鎖」、「解鎖」按鈕
行為       進入 S15 前一定經過；App 進背景就重新上鎖；畫面開啟 expo-screen-capture 防截圖
used on   S15
```

## OneTimePaywall（買斷制，依 fixes F2）

```
內容       標題、3 個重點（不放廣告／付一次永久使用／照片不上傳）、價格（從商店取得的當地幣別）、
          「購買」（primary）、「還原購買」（ghost，iOS 審核必備）、條款與隱私連結
出現時機    **不在第一次滑動前**；只在免費額度用完或點升級時
used on   S04、S07
```
