# Recon map: Picnic: Clean Up Storage（iOS）

範圍：只做核心三塊：(1) 滑動保留／封存照片的流程、(2) 相似照片偵測與比較、(3) 刪除確認與復原。
對象：手機照片很多、懶得整理的人。成品要上架 App Store 販售。
日期：2026-11-12

> **Clean-room 原則**：這份文件只記錄 Picnic「做了什麼、使用者怎麼操作」。名稱、文案、圖示、插圖、配色都不能沿用。
> 以下資料全部來自公開頁面，沒有登入任何帳號，沒有反編譯，也沒有攔截 App 的網路請求。

## 這份 recon 的盲點（先講清楚）

- **沒看到任何截圖或影片。** App Store 截圖放在 `is1-ssl.mzstatic.com`，被這個 session 的網路政策擋掉了。ScreensDesign 的完整流程影片要付費帳號。
  所以畫面清單是從**文字描述**推出來的：商店說明、ScreensDesign 的文字拆解（附影片時間碼）、使用者評論。每一列都標了信心度。
- **「相似照片偵測」的證據最薄弱。** 目前的商店說明沒有提到這個功能，只有兩則評論提到「compare feature」「Comparison tools」。偵測方式和介面細節都是推測。
- **要補強，最有效的方法**：你自己在 iPhone 上裝 Picnic 走一遍免費流程（不付費、不繞過付費牆），把各畫面截圖放進 `replica/screens/`。
  另一個方法是在環境的網路設定允許 `is1-ssl.mzstatic.com`，我就能讀商店截圖。

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | App Store 頁面（美區） | https://apps.apple.com/us/app/picnic-photos/id6450713784 | 說明文字、內購價格、版本紀錄、隱私標籤、評論。4.8 分，約 1 萬則評分。v4.1.16（2026-11-05），需要 iOS 17 以上，154.1 MB |
| 2 | App Store 頁面（愛爾蘭區） | https://apps.apple.com/ie/app/picnic-photos/id6450713784 | 說明文字相同。評論提到「依月份分區」 |
| 3 | ScreensDesign 拆解 | https://screensdesign.com/showcase/photo-organizer-picnic | 文字版流程拆解，附影片時間碼：5 步 onboarding、付費牆、滑動覆蓋層、Undo、空間釋放動畫、streak |
| 4 | MWM Studio 產品頁 | https://mwm.ai/mwm-studio/apps/picnic | 官方賣點、精選評論（提到 compare 功能、進「最近刪除」、shuffle） |
| 5 | SourceForge 收錄頁 | https://sourceforge.net/app/picnic-photos/iphone/ | 功能摘要（重複照片、截圖） |
| 6 | 隱私權／條款 | https://picnic.photos/privacy 、 https://picnic.photos/terms | 未讀取（網址不在允許清單），只記下連結 |
| — | 開發商 | — | 賣家是 MWM（法國 App 發行商），版權標示為 Picnic Ventures Ltd |

## Core loop

**把幾萬張照片拆成一張一張的「留／不留」決定，用滑動快速做完，最後一次清空、釋放空間，並且看得到省下多少 GB。**

## Screens

| ID | screen | how to reach | purpose | key components | states seen | confidence |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Onboarding（5 步） | 第一次開啟 | 說明價值與操作方式 | 全螢幕說明頁、下一步按鈕、頁碼指示 | filled | medium（[3]「5 onboarding steps」） |
| S02 | 相簿權限 | S01 之後，iOS 系統視窗 | 取得相簿讀寫權限 | 系統權限視窗；選「有限存取」時顯示 limited 提示 | 允許、有限存取、拒絕（推測） | high（App 必要條件） |
| S03 | 掃描相簿動畫 | 授權後 | 把等待時間變成價值預覽：閃過使用者自己的照片和年份計數 | 照片拼貼動畫、年份計數器 | loading | high（[3] 00:26） |
| S04 | 付費牆 | S03 之後；免費額度用完時 | 訂閱：週方案（3 天試用）／年方案（以每週價格呈現） | 方案卡、試用開關、關閉 ✕ | trial、方案切換 | high（[3] 01:19；[1] 內購清單） |
| S05 | 首頁／分區清單 | 主畫面 | 把相簿依月份等方式切成小區塊，顯示每區進度 | 分區卡（月份、張數、進度條）、剩餘滑動次數、封存區入口 | empty（全部整理完）、filled | medium（[2] 評論「divides it all up into sections… finish a month」） |
| S06 | 滑動整理（卡片堆） | 點 S05 的分區 | 核心：右滑保留、左滑封存；雙擊加入最愛 | 照片卡、Keep／Archive 彩色覆蓋層、Undo 按鈕（動作後短暫出現）、剩餘張數 | 拖曳中、已決定、Undo 可用、影片卡（推測） | high（[1][3] 01:42、02:30） |
| S07 | 每日額度用完 | S06 滑到第 100 張 | 免費每日 100 次；可以看廣告／streak 獎勵換更多，或升級 | 提示卡、升級按鈕、明天再來 | — | high（[1]「100 free swipes every day」；評論提到 streak 加額度） |
| S08 | 比較相似照片 | 推測：遇到連拍／相似組時從 S06 進入，或從 S05 的專區進入 | 一次看一組相似照片，挑最好的那張，其他送封存 | 並排或可左右捲的照片、選取、保留這張 | — | **guess**（只有 [4] 的評論提到 compare） |
| S09 | 封存區（Archive） | S05／S06 的入口 | 檢查要刪的照片；還原誤判的照片；一鍵清空 | 縮圖格狀清單、選取、還原、「清空」按鈕、總大小 | empty、filled | high（[1][4]「waits safely in the Archive until you're sure」） |
| S10 | iOS 刪除確認 | S09 按清空 | 系統視窗：「允許 App 刪除 N 張照片？」 | 系統 alert（App 無法自訂或略過） | 允許、不允許 | high（iOS 機制；[3][4] 提到照片會進「最近刪除」） |
| S11 | 空間釋放慶祝 | S10 允許之後 | 用動畫顯示這次省下的空間 | 動畫、GB 數字、繼續按鈕 | — | high（[3] 03:08；評論「144GB Saved」） |
| S12 | 分區完成 | S06 滑完一個分區 | 給成就感，引導到下一區或清空封存區 | 完成畫面、統計、下一步 | — | medium（[2] 評論） |
| S13 | 進度／streak 儀表板 | 首頁分頁（推測） | 連續天數、整體進度、設定每日目標 | streak 計數、進度環、目標選擇 | — | high（[3] 04:58、05:21）——**不在核心範圍** |
| S14 | 推薦好友 | 設定或獎勵入口 | 邀請好友換獎勵 | 分享連結 | — | high（[3] 04:42）——**不在核心範圍** |

## Flows

```
F01 新使用者第一次滑照片
    S01(×5) -> S02 -> S03 -> S04 -> S05 -> S06
    happy path clicks：約 9（onboarding 5 + 允許權限 1 + 關閉付費牆或開始試用 1 + 選分區 1 + 第一滑 1）
    edge：拒絕權限、只給「有限存取」、相簿 0 張、iCloud 照片還沒下載完（縮圖模糊／載入中）
    要打敗的數字：從打開 App 到第一次滑動 ≤ 3 下（先讓人試滑，再談付費）

F02 整理一個分區
    S05 -> S06（左右滑 N 次）-> S12
    happy path clicks：1 + N 次滑動
    edge：分區裡有影片、Live Photo、連拍；中途離開再回來要接續；滑到每日上限 -> S07

F03 復原上一個動作
    S06 點 Undo
    happy path clicks：1
    edge：Undo 只在動作後「短暫出現」（[3]），能復原幾步不清楚（推測只有 1 步）；
          已經從系統刪掉的照片不能在這裡復原

F04 從相似照片裡挑最好的一張                                       （guess）
    S06 或 S05 -> S08 -> 選 1 張保留 -> 其餘進封存 -> 回到原處
    happy path clicks：約 2–3
    edge：一組超過 10 張、組內有影片、使用者全部都想留、判斷錯誤（其實不相似）

F05 清空封存區、真正釋放空間
    S05 -> S09 -> 點「清空」-> S10 點「刪除」-> S11
    happy path clicks：3
    edge：在 S10 按「不允許」（照片要留在封存區）；共享相簿或別人的照片不能刪；
          照片已經在別處被刪掉；空間其實 30 天後才真的釋放（在「最近刪除」裡）

F06 還原誤封存的照片
    S09 選取 -> 還原
    happy path clicks：2
    edge：還原後要回到原本分區的未整理狀態

F07 刪除後反悔
    （App 外）照片 App -> 最近刪除 -> 復原，30 天內有效
    edge：iOS 不提供 API 讓 App 從「最近刪除」還原，只能請使用者自己去照片 App
```

## 新增（不是 Picnic 的功能）

使用者在規劃階段加的需求，2026-11-12：

```
F08 往上滑隱藏照片
    S06 往上滑 -> （第一次）S16 說明／警告 -> 照片進隱藏區
    iOS：系統「已隱藏」相簿；Android：App 內上鎖相簿（檔案搬進 App 私有空間）

F09 取消隱藏
    S15 解鎖 -> 選取 -> 搬回相簿
```

| ID | screen | purpose |
| --- | --- | --- |
| S15 | 上鎖相簿／隱藏照片 | 解鎖後檢視隱藏的照片、搬回相簿、全部搬回 |
| S16 | 隱藏說明 | 第一次往上滑時說明；Android 警告「移除 App 會刪掉上鎖相簿的照片」 |

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| SwipeCard 照片卡 | 照片、影片、Live Photo（推測） | idle、拖曳中（旋轉 + 覆蓋層漸顯）、飛出、彈回 | S06 |
| DecisionOverlay 決定覆蓋層 | keep（右）、archive（左） | 依拖曳距離 0–100% 顯示 | S06 |
| UndoButton 復原 | 浮動按鈕 | 隱藏、出現（有時效）、按下 | S06 |
| FavoriteBurst 最愛動畫 | 雙擊 | 觸發、已是最愛 | S06 |
| SectionCard 分區卡 | 月份、其他分組（推測） | 未開始、進行中（進度條）、完成 | S05 |
| QuotaBadge 剩餘次數 | 免費、無限（訂閱） | 正常、快用完、用完 | S05、S06、S07 |
| ThumbGrid 縮圖格 | 可選取 | 一般、已選、載入中、檔案不存在 | S09、S08 |
| CompareViewer 比較檢視 | 並排／可捲動（guess） | 選取中、已選最佳 | S08 |
| PrimaryButton | primary、danger（清空）、ghost | default、pressed、disabled、loading | 全部 |
| PaywallPlanCard | weekly + trial、annual | 選取、未選 | S04 |
| CelebrationSheet | 空間釋放、分區完成 | 動畫中、靜止 | S11、S12 |
| SystemAlert | iOS 原生（權限、刪除確認） | 允許、拒絕 | S02、S10 |

## Inferred data model

全部存在手機上：商店標示「照片不離開 iPhone」，看不到帳號系統。

```
PhotoAsset   localIdentifier, creationDate, mediaType (image|video|livePhoto),
             pixelWidth, pixelHeight, fileSize, isFavorite
             evidence：iOS PhotoKit 的 PHAsset；S06 雙擊最愛會同步到 Apple 照片（[1]）
             confidence：high（這是系統資料，不是 App 自己存的）

Decision     assetId, value (keep | archive), decidedAt, sectionId
             evidence：S06 左右滑；已保留的不會再出現
             confidence：high

ArchiveItem  assetId, archivedAt, status (archived | deleted | restored), byteSize
             evidence：S09「waits safely in the Archive until you're sure」、一鍵清空（[4]）
             confidence：high（欄位是推測）

Section      id, kind (month | ?), dateFrom, dateTo, totalCount, decidedCount
             evidence：[2] 評論「divides it all up into sections… finish a month」
             confidence：medium（除了月份還有哪些分法不清楚）

SimilarGroup id, assetIds[], suggestedBestId?, resolvedAt?
             evidence：[4] 評論提到 compare
             confidence：guess

UndoEntry    assetId, previousState, at
             evidence：S06 Undo（[3] 02:30）
             confidence：medium（深度推測 1 步）

DailyQuota   date, used, baseLimit (100), bonus
             evidence：[1]「100 free swipes every day, plus easy ways to earn more」；評論說 streak 獎勵上限曾經是 250 → 150
             confidence：high

Streak       currentDays, longestDays, lastActiveDate
             evidence：評論與 [3] 04:58
             confidence：high（不在核心範圍）

Stats        bytesFreed, photosDeleted, photosKept
             evidence：S11 動畫（[3] 03:08）、評論標題「144GB Saved」
             confidence：high

Entitlement  plan (weekly | monthly | annual), status, trialEndsAt
             evidence：[1] 內購：週 $4.99–$7.99、月 $9.99、年 $19.99–$39.99（A/B 價格很多組）
             confidence：high
```

Relationships：Section 1-n PhotoAsset；PhotoAsset 1-0..1 Decision；Decision(archive) 1-1 ArchiveItem；SimilarGroup n-n PhotoAsset。

## Feature matrix

見 `features.csv`。must：18（含新增的隱藏功能 5 項）、should：9、could：7、skip：5。

## 公開資料互相矛盾的地方（定位機會）

- **「Ad-Free」vs 實際有廣告**：商店說明和官網都寫「零廣告」，但 2025 年 7 月和 9 月的評論說「每 5 滑跳一次全螢幕廣告」，開發者回覆也承認了。商店的「Contains: Advertising」標示也證實有廣告。
- **「每天 100 次免費」vs「先付費才能用」**：ScreensDesign 觀察到的是 paywall-first（要先開試用才能滑），商店說明則強調免費額度。很可能是 A/B 測試，內購有 10 組不同價格也是佐證。
- **訂閱價偏高、沒有買斷**：評論抱怨週訂閱 $8，有人希望有「終身方案」。
- 這幾點交給 `/replica-entrepreneur` 做定位：例如「真的沒廣告」「買斷制」「先試滑再付費」。

## Out of scope（不能或不該照抄）

- **品牌**：「Picnic」名稱、圖示、插圖、文案、活動（如「Cozy Autumn」），一律重做（交給 `/replica-brand`）。
- **廣告與 A/B 價格系統**：不照抄。這正是評論最不滿的地方。
- **Streak、目標、推薦好友、shuffle、On This Day**：不在你指定的核心範圍，列為 could。
- **MWM 的投放與發行能力**：Picnic 每月約 8 萬次安裝，靠的是付費廣告（[4] 評論「Saw an ad for it on insta」），這部分不是產品本身能複製的。

## 上架風險（要賣就要先面對）

- **App Store 審核準則 4.3（Spam）**：「滑動清理照片」已經有大量同類 App（Swipewipe、PicSwipe、Swipe To Delete…，連 MWM 自己都有兩款）。
  沒有明顯差異化的話很可能被拒。差異化要在 `/replica-entrepreneur` 定好再送審。
- **準則 3.1.2（訂閱）**：試用期、價格、自動續訂說明必須清楚呈現。
- **準則 5.2（智慧財產）**：不能用 Picnic 的名稱、截圖風格或文案。

## Size

畫面 12 個（核心）、流程 7 條、實體 8 個（核心範圍內）。

困難的部分：
1. **相似照片偵測**：要在手機上對兩三萬張照片算影像特徵（iOS 可以用 Vision 的 `VNGenerateImageFeaturePrintRequest`），
   還要顧到背景執行、耗電、增量更新、分組門檻。目前的 Flutter 原型沒有這塊，需要寫 iOS 原生 plugin，或改成原生 SwiftUI。
2. **流暢滑動**：iCloud 照片的縮圖要預載，大圖解碼不能卡；影片和 Live Photo 要另外處理。
3. **刪除的邊界情況**：系統確認視窗不能略過；共享相簿、iCloud 照片不能刪；只給「有限存取」時的行為；
   空間其實要等「最近刪除」30 天後才釋放，要讓使用者看懂。
4. **上架**：4.3 被拒的風險，加上訂閱合規（StoreKit 2）。

規模：**M**（幾週）。核心滑動和封存區在現有 Flutter 原型裡已經有雛形，相似照片偵測和 iOS 打磨是主要工作量。

## 和現有原型（mobile/swipe_clean）的差異

- **滑動方向相反**：Picnic 是右滑保留、左滑封存（和 Tinder 一樣）。現有原型照你最初的要求做成右滑刪除、左滑保存。
  要賣給一般使用者，建議改成 Picnic／Tinder 的方向，因為大家已經習慣；但這要你決定。
- 原型已經有：App 內垃圾桶（＝封存區）、批次移到系統垃圾桶、復原上一步、保存清單。
- 原型還沒有：相似照片、依月份分區、空間釋放統計、每日額度與訂閱、Live Photo／影片支援。
