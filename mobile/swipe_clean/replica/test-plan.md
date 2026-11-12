# Test plan：滑滑整理（Flutter 原型）

Build：見 git log　Date：2026-11-12　Env：`flutter test`（單元＋畫面測試，用假的權限來源）；實機手動

這一版只涵蓋**相簿權限**（F01 的權限部分），因為這次處理的是兩個權限 bug。
滑動、垃圾桶、刪除流程的完整測試計畫之後補。

自動測試在 `test/permission_test.dart`。原型是 Flutter，所以用 `flutter test`，不是 Playwright。

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| P-H1 | happy | 第一次開 App → 允許全部 | 不顯示「部分照片」提示，讀到照片 | widget | pass |
| P-H2 | happy | 系統狀態對應 | authorized→完整、limited→部分、denied／restricted／notDetermined→拒絕 | unit | pass |
| P-E1 | edge | 請求權限的選項 | Android 只請求照片（`RequestType.image`），不連影片一起要 | unit | pass（BUG-001） |
| P-E2 | edge | 部分 → 設定改成全部 → 按「重新讀取相簿」 | 變成完整，提示消失 | unit + widget | pass（BUG-001） |
| P-E3 | edge | 部分 → 點「選更多」 | 出現「再多選幾張」「允許存取全部照片」和一句說明 | widget | pass（BUG-002） |
| P-E4 | edge | 「允許存取全部照片」 | 開這個 App 的系統設定頁 | widget | pass |
| P-E5 | edge | 「再多選幾張」 | 開系統照片選擇器，回來後重讀 | widget | pass |
| P-E6 | edge | 回到前景 | 只檢查權限，**不跳**權限視窗 | unit | pass |
| P-N1 | negative | 完全拒絕 | 顯示說明、「允許存取相簿」、「前往設定」 | widget | pass |
| P-N2 | negative | 拒絕 → 設定開啟 → 回到前景 | 變成完整，讀到照片 | unit | pass |
| P-N3 | negative | 完整 → 設定關掉權限 → 回到前景 | 變成拒絕，清空待整理清單 | unit | pass |
| P-M1 | manual | Pixel 8／API 37：BUG-001 原始步驟 | 提示消失 | 手動 | 待使用者驗證 |
| P-M2 | manual | Android 14+：選更多 → 允許存取全部 → 設定改全部 → 返回 | 提示消失，照片變多 | 手動 | 待使用者驗證 |
| P-M3 | manual | 刪除時跳出系統確認視窗 → 允許 → 回到 App | 不會因為「回到前景」重讀而打斷刪除 | 手動 | 待驗證 |


---

# Test plan：Expo 版（mobile/app）

Build：e01d0a6　Date：2026-11-12　Env：Jest（node:sqlite 跑真 SQL、假相簿）＋ web e2e（Chromium 觸控、390×844）

自動測試：`npm test`（35 個）、`npm run e2e:web`（14 步）。重點依你的要求：**權限被拒、上萬張照片、iCloud 照片**。

| case | flow | type | 內容 | expected | auto | result |
| --- | --- | --- | --- | --- | --- | --- |
| F02-H1 | 整理 | happy | 右滑、左滑、上滑、按鈕 | 保留／封存／隱藏，計數正確 | e2e + unit | pass |
| F02-E1 | 整理 | edge：短拖 | 沒過門檻 | 彈回，不算 | e2e + unit | pass |
| F02-E2 | 整理 | edge：斜上 38° | 往右上方拖 | 判成保留，不誤觸隱藏 | unit | pass |
| F02-E3 | 整理 | edge：滑很快 | 載入下一頁時繼續滑 | 滑過的不會跑回來 | unit | pass（BUG-003） |
| F02-E4 | 整理 | edge：重開 App | 滑兩張後重開 | 從第三張接著滑 | unit | pass |
| F02-E5 | 整理 | edge：牌堆空 | 全部滑完 | 「全部整理完了」＋前往封存區 | unit | pass |
| F03-H1 | 復原 | happy | 刪除後按復原 | 照片回到最前面、封存區 -1 | e2e + unit | pass |
| F03-N1 | 復原 | negative | 已送進系統垃圾桶後復原 | 不能復原 | unit | pass |
| F05-H1 | 清空 | happy | 封存 2 張 → 移除 → 系統允許 | 一次系統確認、顯示約 X MB、封存區清空 | e2e + unit | pass |
| F05-N1 | 清空 | negative：按取消 | 系統視窗取消 | 照片留在封存區、顯示「已取消」 | unit | pass |
| F05-E1 | 清空 | edge：520 張 | 一次清空 | 分 2 批（500＋20） | unit | pass |
| F05-E2 | 清空 | edge：刪到一半 App 被殺 | 重開 | 依照片在不在對帳，不自動重送 | unit | pass |
| F06-H1 | 還原 | happy | 封存區選取 → 還原 | 回到牌堆 | unit | pass |
| P-N1 | 權限 | **被拒** | 開 App 拒絕 | 說明＋「允許存取」＋「前往設定」 | e2e + unit | pass |
| P-N2 | 權限 | **被拒** → 設定開啟 → 回前景 | | 讀得到照片 | unit | pass |
| P-N3 | 權限 | 完整 → 設定關掉 → 回前景 | | 變成拒絕、清空牌堆 | unit | pass |
| P-E1 | 權限 | 部分 → 選更多 | | 兩個選項＋說明 | e2e | pass |
| P-E2 | 權限 | 部分 → 改成完整 → 回前景 | | 狀態更新 | unit | pass |
| L-1 | **上萬張** | 20,000 張開啟 | | 只讀第一頁（4 ms） | unit | pass |
| L-2 | **上萬張** | 連滑 3,000 張 | | 每滑耗時不增加（0.11 → 0.13 ms） | unit | pass |
| L-3 | **上萬張** | 清空 5,000 張 | | 10 批、全部算到（157 ms） | unit | pass |
| C-1 | **iCloud** | 原圖只在 iCloud 的照片 | | 卡片先顯示縮圖、不卡住 | 手動（iPhone） | **未測：沒有 iPhone** |
| C-2 | **iCloud** | 行動網路下滑 iCloud 照片 | | 不大量耗流量 | 手動（iPhone） | **未測** |
| D-1 | 實機 | Android 11+：清空 500 張 | | 系統視窗只跳一次、照片進垃圾桶 | 手動 | 待你用 APK 驗證 |
| D-2 | 實機 | Android：系統垃圾桶的照片在 Google 相簿／三星圖庫看不看得到 | | 記錄結果 | 手動 | 待驗證 |
| D-3 | 實機 | 往上滑 vs Android 回主畫面手勢 | | 不衝突 | 手動 | 待驗證 |

**注意**：iCloud 相關（C-1、C-2）在這個環境沒辦法測，要等 iOS 階段在 iPhone 上手動測。效能數字是 Node 上的，手機會慢一些，重點是「不會隨張數變慢」。
