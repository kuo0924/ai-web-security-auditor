# Build log（Expo 版，mobile/app）

| 日期 | 畫面 / 里程碑 | 狀態 | 還缺什麼 | 比預期難的地方 |
| --- | --- | --- | --- | --- |
| 2026-11-12 | 骨架：Expo SDK 58、expo-router、tokens、基本元件、/design | done | — | `expo install` 要連 `api.expo.dev`（被網路擋），改用 `EXPO_OFFLINE=1` 讀套件內建的相容表；TypeScript 6 不再自動載入 `@types/*` |
| 2026-11-12 | **垂直切片**：讀相簿 → 滑動 → 系統垃圾桶 → 釋放空間 | done（web＋單元測試）／**實機待驗證** | iOS 路徑沒在 iPhone 跑過；Android APK 見下一列 | 見下方「抓到的 bug」 |
| 2026-11-12 | S06 滑動整理 | done | 後面 5 張縮圖預載；Live Photo／影片卡片；月份分區（S05） | RNGH 3.x 改成 hook API（`usePanGesture`）；web 上滑鼠拖曳不會觸發手勢，觸控可以（只影響 web 預覽） |
| 2026-11-12 | S02 權限（完整／部分＋選更多／拒絕） | done | — | 沿用 Flutter 原型 BUG-001/002 的教訓：只請求 `['photo']` |
| 2026-11-12 | S09 封存區 | done | 格狀清單上方顯示總大小；長按預覽 | — |
| 2026-11-12 | S10 App 內確認 → 系統確認 | done（Android 用自訂模組 `createTrashRequest`） | 實機確認系統視窗只跳一次 | Expo 的 `Asset.delete` 在 Android 是永久刪除，所以自己寫 `modules/photo-actions` |
| 2026-11-12 | S11 釋放空間 | partial | 數字跑動動畫 | 寫「約 X」：iOS 拿不到檔案大小，用解析度估算 |
| 2026-11-12 | Android release APK | done（未實機執行） | 實機測試 | 需要 JDK 17、`repo.reactnative.dev`；自己的原生模組少宣告 `androidx.activity`；相依套件帶進多餘權限（已擋） |
| 2026-11-12 | **S08 相似照片**：偵測＋比較畫面 | done（web＋單元測試）／**實機待驗證** | 門檻要用真照片調；iCloud 照片的分析速度與流量 | 測試資料的合成場景每 80 個 seed 重複，造成「完全相同的圖」被正確分組；改用 mulberry32 產生版面 |
| — | 往上滑隱藏 | partial | 只做了手勢和記錄（`hidden_items.status = 'hiding'`）；Android 上鎖相簿、iOS `isHidden` 都還沒做 | — |
| — | S05、S07、S12–S16 | not started | 月份分區、付費牆、onboarding、上鎖相簿 | — |

## 測試

- Jest **57 個**（`npm test`），包含 3 個兩萬張照片的規模測試、14 個雜湊／分組、8 個相似照片流程。資料層用 Node 內建的 `node:sqlite` 跑**跟 App 一樣的 `schema.sql`**，不是 mock。
  （垂直切片的 commit 訊息寫 33，當時實際是 32；之後加了規模測試變成 35。）
- Web e2e **14＋12 步**（`npm run e2e:web`：主流程＋相似照片），用真的觸控事件、手機寬度 390×844：
  拖曳左／右／上、短拖彈回、按鈕、復原、封存區、App 內確認、釋放空間、拒絕畫面、選更多、空封存區。
  0 個 console 錯誤。截圖在 `clone-screens/`。
- **沒有在 Android 或 iOS 實機／模擬器上跑過**。這個環境沒有 KVM，也沒有 Mac。

## 抓到並修好的 bug（測試寫出來之前就存在的設計錯誤）

1. **載入下一頁期間繼續滑，滑過的照片會跑回來。** `loadMore()` 用「開始載入時」的牌堆快照覆蓋目前狀態。
   改成合併進目前的牌堆，並跳過載入期間才做決定的照片。回歸測試：「載入下一頁期間繼續滑」。
2. **背景載入和滑動的資料庫交易交錯，決定會悄悄寫入失敗。** 同一條連線上兩個交易交錯；
   expo-sqlite 的 `withTransactionAsync` 也不是互斥的，所以實機一樣會發生。
   改成 Repo 裡所有存取排隊。另外加上「每個測試結束時 `state.error` 必須是空的」，避免錯誤再被吞掉。
3. 假相簿回報的刪除方式 `'fake'` 不在 schema 的 CHECK 範圍裡，真的 SQL 會拒絕。
   移除 `'fake'`，假相簿改成模擬 Android 11+。

## 偏離架構文件的地方

- 還沒用 Drizzle：先用一個很小的 `Db` 介面＋原始 SQL，好讓同一份 SQL 在 Jest 用 `node:sqlite` 測。之後要換 Drizzle 也只改 `data/`。
- web 預覽用 `MemoryRepo`（瀏覽器沒有 expo-sqlite 原生資料庫）。正式行為以 SQLite 的 `Repo` 為準。
