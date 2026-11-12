# Brand：Onceover（一次清）

依據：`fixes.md` 的定位角度 A：不放廣告、付一次就好、照片不離開手機。
對象：照片很多、懶得整理的人；先在台灣上 Google Play，之後上 App Store。

> **名稱還是暫定的。** 下面的檢查是「篩選」，不是法律上的商標調查。花錢買網域、做 icon 之前，先完成表格裡「待執行」的項目，最好請商標律師查一次。

## 1. 名稱

### 20 個候選

| 類型 | 候選 |
| --- | --- |
| 描述型 | RollClean、PhotoTidy、Camera Roll Sorter、相簿清 |
| 複合型 | Rollsift、Tidyroll、Keepfew、Cullwise、Snapsieve |
| 自創 | Sorla、Klinn、Fotlo、Pikkeo |
| 比喻 | Winnow（揚穀去糠）、Leafthrough（翻閱）、Pebble、Lantern |
| 動詞／片語 | **Onceover**（give it a once-over＝很快看過一遍）、Pareback、Sift |

### 篩到 5 個的理由

- **刪掉**：
  - **Rollsift、Tidyroll、Cullwise、Pareback、Winnow 都已經有同類的照片清理 App**（實際查過，見下表）。
  - Sift（Sift Science 是大型商標）、Pebble（手錶品牌）、Lumi（很多 App 在用）：太擁擠。
  - 任何跟原版名字諧音、或用「-ly」結尾的：刻意避開。
- **留下**：Onceover、Keepfew、Sorla、Leafthrough，加上中文名「一次清」。

### 推薦：**Onceover**（中文：**一次清**）

- 「give your camera roll a once-over」＝把相簿很快看過一遍，就是這個 App 在做的事。
- 「Once」呼應定位：**付一次**就好、**一次**清乾淨。
- 9 個字母，聽一次就拼得出來；英文、中文都沒有不好的意思。
- 跟原版的名字在聲音、字形、意思上都沒有關係。
- 中文名「一次清」：好唸、直接講出用途。台灣 Play 商店的標題可以寫「Onceover 一次清：照片整理」。

## 2. 檢查（日期都是 2026-11-12，實際執行的才標結果）

| 檢查 | Onceover | Keepfew | Sorla | Leafthrough | 一次清 |
| --- | --- | --- | --- | --- | --- |
| App Store 美區（Apple 公開搜尋 API，比對 App 名稱） | **沒有同名 App** | 沒有 | 沒有 | 沒有 | — |
| App Store 台灣區（同上） | **沒有同名 App** | 沒有 | 沒有 | 沒有 | 沒有名稱含「一次清」的 App（14 筆結果都不同名） |
| 網路搜尋「名稱＋app」 | 沒找到同名 App（只有 OnceIt、Once 等不同名的） | 沒找到 | 沒找到（有 Soora App，名字不同） | 沒找到 | 待執行 |
| Google Play | **待執行**（這個環境連不到 Play 商店） | 待執行 | 待執行 | 待執行 | 待執行 |
| 美國商標 USPTO（第 9、42 類） | **待執行**（tmsearch.uspto.gov 連不到） | 待執行 | 待執行 | 待執行 | — |
| 台灣商標（智慧局 TIPO 商標檢索） | **待執行** | 待執行 | 待執行 | 待執行 | **待執行** |
| 歐盟 EUIPO／TMview | 待執行 | 待執行 | 待執行 | 待執行 | — |
| WIPO Global Brand Database | 待執行 | 待執行 | 待執行 | 待執行 | 待執行 |
| 網域（onceover.app、.com、.tw） | **待執行**（沒有 whois 工具、註冊商網站連不到） | 待執行 | 待執行 | 待執行 | — |
| 社群帳號（Instagram、Threads、X、TikTok） | 待執行 | 待執行 | 待執行 | 待執行 | — |

**已經查到、確定不能用的**（同一天實際搜尋 App Store）：

| 名稱 | 已存在的同類 App |
| --- | --- |
| Rollsift | 「RollSift」（Cairn Softwares）、「Clean Up Storage: RollSift」 |
| Tidyroll | 「TidyRoll - Photo Cleaner Swipe」、「Tidyroll: Photo Cleaner」等 3 個以上 |
| Cullwise | 「Cullwise: Photo Cleanup by AI」（台灣區） |
| Pareback | 「Pareback: Photo Cleaner」／「Pareback 相簿清理」 |
| Winnow | 「Winnow Photo Cleaner」、「Winnow：照片清理、釋放手機空間」 |

這也說明這個類別非常擁擠：上架前一定要把台灣和美國的商標查完。

## 3. 配色

- **主色：berry（莓果紅紫）**。淺色 `#A3216F`，深色 `#F38BC6`。
- **刻意避開原版的顏色**：螢光黃綠 `#EBFC20`、天空藍 `#2D98C6`、薰衣草紫 `#D299FF`、亮綠 `#6EF982`（從商店截圖取樣）。
  這些都寫進了 `brand.json`，`sweep.py` 會擋。
- 原本的佔位藍 `#2F5BEA` 跟原版的天空藍太接近，所以換掉。
- keep（綠）、delete（紅）、hide（紫）是**語意色**，所有滑動 App 都用綠＝留、紅＝刪，這是使用習慣，不是品牌外觀。
  我們的深色 hide `#AE9BFF` 跟原版的薰衣草紫有點接近，但用途不同（原版用在「最佳照片」標籤）。如果你在意，可以把 hide 改成靛藍。
- 對比檢查：淺色、深色各 25 組，**0 個 AA 失敗**（`design/contrast-report.txt`）。

## 4. Logo brief（給設計師或圖像模型）

- **概念**：一個「掃過一次就清爽」的動作。例如一道弧形的掃動軌跡，劃過三張疊起來的照片，最上面那張被掃開。
  也可以是「O」字（Once 的 O），中間的缺口就是一張被滑走的照片。
- **形式**：圖形＋文字標誌。App icon 只用圖形。
- **顏色**：berry `#A3216F` 為主，白色圖形；不要用黃綠、天空藍。
- **一定要能在 16px（網站 favicon）看得清楚，也要能做 1024px 的 App icon。**
- **交付物**：
  - SVG 原始檔
  - App icon 1024×1024，**不能有透明背景**（iOS 規定）
  - Android adaptive icon（前景／背景分開、單色版）
  - favicon 一組
  - 社群分享圖 1200×630
  - Google Play 主視覺圖 1024×500
- **不能像原版**：
  - 原版 icon 是黑底、彩色疊字「PIC NIC」。我們不用黑底，不用彩色字母拼貼，也不用野餐相關的圖像（籃子、格紋布）。
  - 做好後放在原版 icon 旁邊比一次。

## 5. 語氣

三個詞：

- **安心**：不是被動。刪除前先講清楚、刪錯能救回，但不要一直問「你確定嗎」。
- **直接**：不是生硬。一句話講完，用動詞開頭。
- **輕鬆**：不是搞笑。整理照片已經夠煩了，不要再丟梗或用驚嘆號轟炸。

| 要 | 不要 |
| --- | --- |
| 「已移到封存區」 | 「哇！照片飛走啦～🎉」 |
| 「照片都還在封存區，什麼都沒有被刪除。」 | 「操作失敗（錯誤碼 3072）」 |
| 「約 2.4 GB」（拿不到準確值就寫「約」） | 「已釋放 2.4 GB！」（其實要等 30 天） |
| 「允許存取相簿」 | 「立即解鎖完整體驗！」 |
| 只在真正需要時才問一次 | 一打開就要評分、每 5 張跳一次升級提示 |

### 最常看到的 10 句（目前 App 裡的文字，都是重新寫的，沒有沿用原版）

| 位置 | 文字 |
| --- | --- |
| 權限：拒絕標題 | 需要相簿權限才能整理照片 |
| 權限：拒絕說明 | 允許讀取相簿後，就能一張一張滑過照片決定去留。照片只在這支手機上處理，不會上傳。 |
| 權限：部分存取 | 目前只能看到你選的部分照片 · 選更多 |
| 滑動後提示 | 已保留／已移到封存區／已隱藏 · 復原 |
| 全部滑完 | 全部整理完了 · 封存區有 N 張等你確認。 |
| 封存區：空 | 封存區是空的 · 在整理畫面往左滑的照片會先放在這裡，確認後再一起刪除。 |
| 清空前確認 | 移除 N 張照片？約 X。照片會移到手機的垃圾桶，30 天內都能救回。接下來系統會再跳一次確認，請按「允許」。 |
| 清空完成 | 約 X · 已移除 N 張照片。空間會在 30 天後系統清空垃圾桶時真正釋放，在那之前都能救回。 |
| 取消 | 已取消 · 照片都還在封存區，什麼都沒有被刪除。 |
| 失敗 | 沒有移除成功 · 照片都還在封存區，什麼都沒有被刪除。 |

## 6. Sweep

- 把 App 裡的佔位名稱「Photo Swipe」全部換成 Onceover：App 名稱、slug、URL scheme、資料庫檔名，
  以及 **Android／iOS 套件 ID 改成 `tw.onceover.app`**。Android 套件 ID 第一次上傳 Play 之後就不能改，所以趁現在定下來。
- `sweep.py app --config replica/brand.json`：**Clean**（2026-11-12）。
  第一次跑抓到 1 處：`tokens.json` 裡我自己寫的備註提到原版名稱和顏色，而這個檔案會打包進 App。已經把那段備註搬到這份文件。
- **還要用眼睛看的**：App icon 和 favicon 還是 Expo 預設圖（要等 logo 做好）；Android 啟動畫面的背景色。
