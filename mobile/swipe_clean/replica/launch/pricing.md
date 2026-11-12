# 定價：Onceover（一次清）

## 對手的公開價格（App Store 美區「App 內購買項目」，2026-11-12 讀取）

| App | 模式 | 內購項目（App Store 頁面列出的，同一商品可能有多個價格，代表 A/B 測試或地區） | 廣告 | 網址 |
| --- | --- | --- | --- | --- |
| Picnic（原版） | 免費＋訂閱 | 週 $4.99／$5.99／$6.99／$7.99、月 $9.99、年 $19.99／$29.99／$35.90／$39.99 | 有（頁面標示 Contains Advertising） | https://apps.apple.com/us/app/picnic-photos/id6450713784 |
| Swipewipe（MWM） | 免費＋訂閱 | 週 $3.99～$9.99、Premium $5.99／$9.99、年 $29.99 | 有 | https://apps.apple.com/us/app/id1583884012 |
| Slidebox | 免費＋訂閱或買斷 | 週 $1.99／$2.99、年 $19.99／$29.99、**終身 $29.99／$49.99** | 有 | https://apps.apple.com/us/app/id984305203 |
| Slider | 免費＋年訂閱 | 年 $19.99（只有一項） | 頁面沒有標示 | https://apps.apple.com/us/app/id6444738335 |

> 價格會變，上架前再查一次。台灣區價格不同，要在 Play Console／App Store Connect 看當地價格級距。

## 評論怎麼說價格（`feedback.md`，1725 則，App Store 美區）

- 價格與付費牆：**263 則**，平均 2.7 星，4 個 App 都有
- 週訂閱／強制試用：**114 則**，平均 2.3 星
- 扣款、取消、退款：**70 則**，平均 1.9 星
- 每日滑動次數限制：81 則，平均 3.5 星（怨氣比上面小）
- 多則評論直接說願意「一次付清」（引用與連結見 `fixes.md`）

## 模式：免費試用 ＋ 一次買斷（一個付費方案）

| 方案 | 給誰 | 內容 | 價格（建議） |
| --- | --- | --- | --- |
| **免費** | 想先試試看的人 | 全部功能，**沒有廣告、沒有每日次數限制**，可以整理 **前 1,000 張**照片（滑過 1,000 張後才需要買） | 免費 |
| **完整版（一次買斷）** | 想把整個相簿清完的人 | 照片張數不限、之後的新功能都包含、可在同一個 Google／Apple 帳號的裝置還原 | **NT$290**（美區 **US$9.99**） |

為什麼這樣定：

- **一次買斷**：直接回應「週訂閱」「沒有理由不能一次付清（又沒有雲端服務）」這類評論。我們沒有後端，沒有每月成本，撐得住。
- **免費額度用「總張數」而不是「每天幾張」**：Picnic、Swipewipe 用每日次數吊著使用者；我們讓人一口氣試到 1,000 張，夠感受到價值（通常已經清出幾 GB）。
- **價格**：低於 Slidebox 終身版（$29.99～$49.99）、約等於對手半個月的週訂閱。台灣定 NT$290，落在 Google Play 台灣常見價格級距。要不要首發優惠價，由你決定。
- **只有一個付費方案**：不做 A/B 價格矩陣（評論抱怨過）。
- 不做訂閱，所以「年訂閱比月訂閱便宜 2 個月」這條不適用。

## 在產品裡修掉扣款抱怨

- **沒有自動續訂**，所以不會有「忘記取消被扣款」的問題。
- **不做會自動轉付費的免費試用**。
- 付費牆**不在第一次滑動之前**出現；只在滑滿 1,000 張或使用者自己點「升級」時出現。
- 付費牆上一定有**「還原購買」**（iOS 審核必備，Android 也放）。
- 購買後立刻解鎖；離線也記得（RevenueCat 快取）。
- 設定頁寫清楚「你買了什麼、在哪個帳號買的」。

## 要建立的商品（你來建，不是 Stripe：手機 App 必須用商店內購）

| 地方 | 建什麼 | ID |
| --- | --- | --- |
| Google Play Console | 一次性商品（in-app product，非消耗型） | `onceover_full` |
| App Store Connect | 非消耗型項目（Non-Consumable） | `onceover_full` |
| RevenueCat | Entitlement | `full` |
| RevenueCat | Offering `default`，Package `lifetime` → 上面兩個商品 | — |
| RevenueCat | 填 Google Play service account JSON、App Store Connect API key（讓 RevenueCat 驗證收據） | — |

App 端：`react-native-purchases`，`Purchases.configure` 依平台用兩把不同的 public SDK key（architecture §3.2）。
