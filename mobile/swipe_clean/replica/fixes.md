# Fixes：同類 App 的使用者討厭什麼、想要什麼

日期：2026-11-12

## 樣本（先講清楚範圍）

- **1725 則評論**（另有 1 則重複，已移除），全部來自 **App Store 美區**，用 Apple 官方公開的評論 RSS 讀取：

  | App | 評論數 | 期間 | 1–2 星 | 5 星 |
  | --- | --- | --- | --- | --- |
  | Picnic（原版） | 326 | 2023-10 → 2026-11 | 132 | 157 |
  | Swipewipe（MWM，約 10 萬評分） | 500 | 2026-09 → 2026-11 | 244 | 177 |
  | Slidebox（約 1.7 萬評分） | 400 | 2024-08 → 2026-11 | 96 | 256 |
  | Slider（約 1.2 萬評分，平均 4.8） | 500 | 2024-11 → 2026-11 | 18 | 444 |

- **限制**：
  - 只有一個商店、一個國家。沒有 Google Play 的評論，但 Google Play 是我們首發的平台。
  - Hacker News 搜尋找不到相關討論，所以沒有列入。
  - `reviews.py` 把 4 個 App 各算一個「來源」，但它們其實都來自 App Store，下面的「來源數」要這樣理解。
  - Swipewipe 的 500 則只涵蓋最近 2 個月，正好是它大量加廣告的時期，比例會偏高。
- 主題是用關鍵字比對分類的（`themes.json`），我修正過兩個誤判：
  - 「month」原本會誤抓「$40/month」這類價格抱怨。
  - 「video」原本會誤抓「看影片廣告」。

  還是會有少量誤判，**數字看大小順序就好，不要當精確值**。
- 原始資料：`reviews.csv`；排名：`feedback.md`。

---

## 1. What they hate（討厭的）

| # | 問題 | 評論數 | 來源 | 平均星數 |
| --- | --- | --- | --- | --- |
| 1 | **廣告太多、打斷滑動** | 364 | 4 | 3.0 |
| 2 | **價格和付費牆** | 263 | 4 | 2.7 |
| 3 | 改版變難用 | 117 | 4 | 1.8 |
| 4 | **週訂閱／強制試用** | 114 | 4 | 2.3 |
| 5 | 當機、卡住 | 84 | 4 | 2.0 |
| 6 | 扣款、取消、退款 | 70 | 4 | 1.9 |
| 7 | 每日滑動次數限制 | 81 | 4 | 3.5 |
| 8 | 載入慢、照片模糊、iCloud 照片 | 53 | 4 | 2.9 |
| 9 | 進度消失、要從頭開始 | 15 | 4 | 2.6 |
| 10 | 突然刪不掉／照片沒真的被刪 | 10 | 3 | 1.9 |
| 11 | 空間沒釋放、「最近刪除」看不懂 | 10 | 4 | 3.4 |
| 12 | 一打開就要你評分 | 6 | 3 | 3.5（**證據薄弱**） |

**廣告**：各 App 的低分評論數差很多。
- Swipewipe：147 則一、二星評論提到廣告。
- Picnic：31 則。
- **Slider：只有 3 則；反而有 63 則四、五星評論在稱讚「沒有廣告」**。
- 「不放廣告」是這個類別裡證據最強的差異點。

> "now it shows an ad after every three photos. I don’t mind ads in a free app, but not this frequently."
> — Picnic 1★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=2/id=6450713784/sortBy=mostRecent/json#review-14262163494)

> "now you have to watch an ad to delete your stuff"
> — Swipewipe 2★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1583884012/sortBy=mostRecent/json#review-14763914141)

> "No ads while swiping, easy and quick, shows how much data you’re saving as you delete photos and videos"
> — Slider 5★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=1/id=6444738335/sortBy=mostRecent/json#review-14681251784)

**週訂閱／價格**：

> "$7.99 a week is maybe the most unhinged price I’ve ever seen for features this basic."
> — Picnic 1★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=1/id=6450713784/sortBy=mostRecent/json#review-14592871719)

> "There is no reason for this app to cost anything but a one time fee. It has no cloud services."
> — Picnic 1★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=2/id=6450713784/sortBy=mostRecent/json#review-14427107754)

> "I’d pay a one time fee to get rid of ads but a subscription is actually so ridiculous."
> — Slider 2★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=1/id=6444738335/sortBy=mostRecent/json#review-14654580481)

**進度消失**（15 則，偏少但 4 個 App 都有）：

> "If you leave the app, the day starts over."
> — Swipewipe 2★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=4/id=1583884012/sortBy=mostRecent/json#review-14697287170)

> "everytime I leave the app for a while, I have to start over because it doesn’t remember where I last stopped."
> — Slidebox 5★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=3/id=984305203/sortBy=mostRecent/json#review-12828121466)

**刪除失效／沒真的刪掉**（10 則，偏少，但抱怨的人都給很低的分數）：

> "after 2 weeks it just stopped deleting photos. I can sort through photos but can’t delete anything so there’s no point to the app anymore."
> — Picnic 1★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=3/id=6450713784/sortBy=mostRecent/json#review-13879848101)

> "Clearing up these pics just for me to look at my recently deleted and they aren’t even there"
> — Slidebox 1★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=4/id=984305203/sortBy=mostRecent/json#review-12732783632)

**太早要評分**（6 則，**證據薄弱**，但修正成本是 0）：

> "Asking for a rating during onboarding — Ridiculous"
> — Picnic 1★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=1/id=6450713784/sortBy=mostRecent/json#review-14609612111)

## 2. What is missing（想要但沒有的）

| # | 想要的 | 評論數 | 來源 | 平均星數 |
| --- | --- | --- | --- | --- |
| 1 | 依月份／年份整理、相簿 | 105 | 4 | 3.9 |
| 2 | 影片、Live Photo 的處理 | 52 | 4 | 4.1 |
| 3 | 重複／相似照片比較 | 43 | 4 | 4.6 |
| 4 | 買斷制／終身方案（見上方價格引用） | 包含在價格主題 | 3 | — |

> "it really does go month by month each year and is such a smooth process"
> — Picnic 5★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=5/id=6450713784/sortBy=mostRecent/json#review-13110514837)

> "The app's strength was in its simplicity.  If I wanted a visually cluttered interface I would"
> — Slidebox 4★（抱怨改版加太多分類方式）· [連結](https://itunes.apple.com/us/rss/customerreviews/page=2/id=984305203/sortBy=mostRecent/json#review-13359209082)

> "Love how it compares similar photos."
> — Picnic 4★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=1/id=6450713784/sortBy=mostRecent/json#review-14518304690)

> "there’s a bug in the duplicate photo comparison screen — the UI does not jump to the next duplicate photo after marking the previous photo for keeping or deletion."
> — Picnic 1★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=3/id=6450713784/sortBy=mostRecent/json#review-13916558848)

> "Please remove or add a toggle for auto-play Live Photos"
> — Slidebox 3★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=1/id=984305203/sortBy=mostRecent/json#review-14151842092)

## 3. What is unsolved（沒人顧到的整件事）

- **「付一次錢、整理完就走」的人**。很多評論的用法是集中幾週整理完，之後就不用了；週訂閱對他們最不划算：

  > "I can’t go through 30k photos in a week."
  > — Picnic 4★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=1/id=6450713784/sortBy=mostRecent/json#review-14518304690)

- **家庭共用 iCloud 的人**：只有 1 則評論提到，**證據薄弱**，只記錄不做。

  > "Being on a family iCloud account, I need the ability for all family members to clean up their photos/videos."
  > — Picnic 3★ · [連結](https://itunes.apple.com/us/rss/customerreviews/page=4/id=6450713784/sortBy=mostRecent/json#review-13550959167)

---

## 4. Fix plan（依「證據強度 × 修正成本」排序）

| # | 要做的 | 規模 | 誰做 | 證據 |
| --- | --- | --- | --- | --- |
| F1 | **永遠不放廣告**，寫進商店頁和 App 裡 | S | `/replica-launch`（承諾）、`/replica-build`（不接任何廣告 SDK） | 廣告 364 則／4 個 App；Slider 63 則稱讚無廣告 |
| F2 | **買斷制**（一次付費解鎖），不做週訂閱；付費牆**不放在第一次滑動之前** | S（RevenueCat 改成 non-consumable 商品） | `/replica-launch` 定價、`/replica-architect` 改付費設計 | 價格 263、週訂閱 114、扣款 70 |
| F3 | **每一滑都立刻存檔**，離開再回來從同一張接著滑；不要「隔天重來」 | S（SQLite 設計已經涵蓋） | `/replica-build` | 進度消失 15 則／4 個 App |
| F4 | **刪除結果看得見**：每次清空後顯示「已移到系統垃圾桶／最近刪除，N 張、約 X GB」；刪除失敗時說清楚原因；App 內可救回（Android） | M | `/replica-build` | 刪不掉 10 則、空間沒釋放 10 則、「最近刪除」相關引用 |
| F5 | **依月份分區，維持簡單**，不要塞一堆分類方式 | M | `/replica-build`（S05） | 依月份整理 105 則；Slidebox 改版變複雜的抱怨 |
| F6 | **相似照片比較要穩**：選完自動跳下一組；比較時不能誤觸滑動 | L | `/replica-build`（S08） | 相似照片 43 則；Picnic 的比較畫面 bug |
| F7 | **Live Photo 預設不自動播放**，長按才播放 | S | `/replica-build` | Live Photo 相關引用（Slidebox） |
| F8 | **不要太早要評分**：至少清空過一次封存區、而且釋放空間之後才問 | S | `/replica-build` | 6 則（證據薄弱，但成本是 0） |

每日滑動次數限制（81 則，平均 3.5 星）的怨氣明顯比廣告和週訂閱小。免費版要不要限制次數，交給 `/replica-launch` 定價時決定，F2 已經包含「不要在第一次滑動前就擋」。

這 8 項都已加進 `features.csv`（`original = no`）。

---

## 5. 定位角度

**A（推薦）：不放廣告、付一次就好**
```
給被廣告打斷、被週訂閱嚇跑、只想把相簿整理乾淨的人，
〔App 名稱〕不放廣告、不搞週訂閱，付一次就能一直用，照片也從不離開手機。
Evidence：廣告 364 則、價格 263 則、週訂閱 114 則，4 個 App 都有。
Slider 的評論證明「沒廣告」本身就能拿到好評。
```

**B：滑過的每一張都算數**
```
給整理到一半進度就不見、刪了卻沒真的刪掉的人，
〔App 名稱〕每一滑都存檔，刪了多少、刪到哪裡都清楚列出，30 天內還能救回。
Evidence：進度消失 15 則、刪不掉 10 則、空間沒釋放 10 則。證據比 A 薄很多。
```

**C：一個月一個月，慢慢清**
```
給一想到幾萬張照片就放棄的人，
〔App 名稱〕把相簿切成一個個月份，每次清一個月，看得到進度。
Evidence：依月份整理 105 則。但 Picnic、Slidebox 都已經有類似功能，差異化比較弱。
```

**推薦 A**，B 和 F4 放進產品細節當支撐。
- A 有最多評論支持，也是對手最難跟進的地方：Picnic 和 Swipewipe 的發行商 MWM 靠廣告和週訂閱賺錢，很難改。
- 我們沒有後端成本，買斷制的成本結構撐得住。

**注意**：
- App 名稱、廣告和商店頁都**不能出現 Picnic 或其他 App 的名字**。
- 這些評論是研究資料，**不能拿去當我們的使用者推薦語**。
- 要做「跟 Picnic 比較」的頁面，先問你所在國家的律師。

下一步：`/replica-brand`（名稱和語氣依角度 A）。
