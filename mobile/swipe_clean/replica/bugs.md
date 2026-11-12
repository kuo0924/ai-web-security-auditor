# Bugs：滑滑整理（Flutter 原型，mobile/swipe_clean）

嚴重度：S1 資料遺失／安全／付款錯誤／核心流程卡死；S2 功能壞掉、沒有替代方法；S3 壞掉但有替代方法，或明顯錯誤；S4 外觀。

| ID | 標題 | 嚴重度 | 狀態 |
| --- | --- | --- | --- |
| BUG-001 | 改成完整權限後，「部分照片」提示仍一直顯示 | S2 | fixed in 73f49b8 |
| BUG-002 | 「選更多」無法升級成完整權限 | S3 | fixed in 73f49b8 |

---

### BUG-001：改成完整權限後，「部分照片」提示仍一直顯示

- Severity：S2
- Flow / case：F01 新使用者第一次滑照片／F01-E（只給部分存取）；權限案例 P-E2
- Screen：S02（權限）、S06 上方提示
- Build：d6b4190　Device：Android 模擬器 Pixel 8，API 37（使用者回報）

Steps
1. 第一次開 App，權限視窗選「只允許部分照片」
2. 到系統設定 → 應用程式資訊 → 權限 → 相片和影片，改成「一律允許全部」
3. 回到 App，按「重新讀取相簿」

Expected：提示消失，讀到全部照片
Actual：上方「目前只允許讀取部分照片」一直顯示

Root cause（讀過 photo_manager 3.12.0 原始碼確認，有兩個）：
1. **請求權限時同時要了照片＋影片。** photo_manager 的預設選項是 `RequestType.common`（image + video），
   但 `AndroidManifest.xml` 只宣告 `READ_MEDIA_IMAGES`，沒有 `READ_MEDIA_VIDEO`。
   `PermissionDelegate34.getAuthValue()` 會把照片（Authorized）和影片（拿不到 → Limited／Denied）合併，
   結果**永遠是 Limited**。所以就算重新檢查，也還是「部分」。
   回報裡推測的「只看 `READ_MEDIA_VISUAL_USER_SELECTED`」不是原因：photo_manager 會先檢查 `READ_MEDIA_IMAGES`。
2. **「重新讀取相簿」和回到前景時沒有重新檢查權限。** `reload()` 只重讀照片，權限狀態停在第一次請求的結果。
   而且回到前景時，如果狀態是「拒絕」，舊程式會呼叫 `requestPermissionAndLoad()`，每次回來都可能再跳一次權限視窗。

Fix：
- 新增 `lib/permissions.dart`：
  - `PhotoAccess { full, partial, denied }`；`photoAccessFrom()` 是唯一的判斷函式。
  - `photoPermissionOption` 改成只要照片（`RequestType.image`）。
  - `PhotoPermissions` 介面（check／request／pickMore／openSettings），測試可以換成假的。
- `AppStore.reload()` 每次都先 `check()` 權限（不跳視窗），再依結果重讀或清空。
  `onResume()` 每次回到前景都走這裡；刪除用的系統確認視窗造成的暫停除外。
- `main.dart` 回到前景一律呼叫 `store.onResume()`，不再自動跳權限視窗。

Evidence（修正前失敗、修正後通過，`test/permission_test.dart`）：
- `只請求照片權限…`：Expected `RequestType(image)`，Actual `RequestType(image, video)`
- `部分 → 到設定改成全部 → 按「重新讀取相簿」`：Expected `full`，Actual `partial`
- `回到前景時要重新檢查權限`、`完全拒絕 → 到設定開啟 → 回到前景`、`完整 → 到設定關掉權限 → 回到前景`
- `部分 → 改成全部 → 回到前景：提示要消失`：修正前提示仍然存在

Status：fixed in 73f49b8

**注意**：這個環境沒有 KVM，跑不了 Android 模擬器。上面是用單元測試和畫面測試重現的，
請用 1.0.2 版 APK 照原本的步驟在 Pixel 8／API 37 上再驗證一次。

---

### BUG-002：「選更多」無法升級成完整權限

- Severity：S3（有替代方法：自己到系統設定改，但 App 裡完全沒有提示）
- Flow / case：F01-E（部分存取）；權限案例 P-E3
- Screen：S06 上方提示（回報中標為 S3 畫面）
- Build：d6b4190　Device：Android 14 以上

Steps
1. 以「只允許部分照片」的狀態開 App
2. 點上方提示的「選更多」

Expected：出現兩個選項
- 「再多選幾張」→ 開系統照片選擇器
- 「允許存取全部照片」→ 直接開這個 App 的系統設定頁

並用一句話說明為什麼需要全部權限。

Actual：直接開系統照片選擇器，只能多勾照片，App 裡沒有任何方法改成允許全部

Fix：「選更多」改成底部選單（`_showMoreAccessSheet`），兩個選項加上說明：
「允許存取全部照片，才能幫你找出所有重複和相似的照片，整理時也不會漏掉。」
選「允許存取全部照片」→ `openSettings()`；從設定回來時由 `onResume()` 重新檢查並更新畫面（BUG-001 的修正）。

Evidence（`test/permission_test.dart`，修正前失敗）：
- `點「選更多」出現兩個選項和一句說明`：修正前找不到「再多選幾張」
- `「允許存取全部照片」→ 開這個 App 的系統設定頁`
- `「再多選幾張」→ 開系統照片選擇器`

Status：fixed in 73f49b8

---

## 一起補上的：完全拒絕權限的畫面

不是回報的 bug，是這次修正規則要求的。原本的拒絕畫面有「允許存取相簿」和一個不明顯的文字連結。現在：
- 說明為什麼需要權限、照片不會上傳。
- 「允許存取相簿」（再請求一次）＋「前往設定」按鈕。
- 提示：按了沒跳視窗，代表之前選過「不允許」，要到設定改。

測試：`完全拒絕權限的畫面 顯示說明和「前往設定」按鈕`。

## To check（還沒重現，不算 bug）

- iOS「有限存取」→ 設定改成「完整存取」後回到 App：邏輯相同（`check()` + `onResume()`），但還沒在 iPhone 上測。
- Android 13（API 33）沒有「部分照片」選項：預期只會出現完整／拒絕兩種狀態，待實機確認。
