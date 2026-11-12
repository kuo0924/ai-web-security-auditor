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
