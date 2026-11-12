# Architecture：照片滑滑整理 App（重做 Picnic 的核心功能）

> 名稱還沒定，交給 `/replica-brand`。這份文件依據 `recon.md` 和 `features.csv`。
> 日期：2026-11-12。版本號以這天 npm 上的最新版為準，我實際讀過套件原始碼確認行為。

## 0. 已定的方向

- **跨平台**：Expo（React Native + TypeScript），一份程式碼。
- **上架順序**：先上 Google Play，之後上 App Store。
- **沒有後端**：照片、雜湊、決定紀錄全部存在手機上，不上傳。
- **付費**：RevenueCat 同時處理 Google Play Billing 和 StoreKit。
- **手勢**（新增往上滑）：

  | 手勢 | 動作 | iPhone | Android |
  | --- | --- | --- | --- |
  | 右滑 | 保留 | 記錄，之後不再出現 | 同左 |
  | 左滑 | 刪除（先進封存區 → 之後批次刪除） | 進「最近刪除」 | 進系統垃圾桶（建議）或永久刪除，見 §4.1 |
  | 往上滑 | **隱藏** | 系統內建「已隱藏」相簿 | **App 內上鎖相簿**（檔案搬進 App 私有空間） |
  | 雙擊 | 加入最愛 | 立即同步 | 先排隊，之後批次送出，見 §4.6 |

- **左右方向已定案（2026-11-12）**：**右滑保留、左滑刪除**，和 Picnic／Tinder 的習慣一致。
  程式裡還是集中在一個常數 `SWIPE_MAP`，不要把方向寫死在各個元件裡。

## 1. Stack

| layer | choice | why |
| --- | --- | --- |
| App 框架 | **Expo SDK 58**（`expo@58.0.x`）+ TypeScript strict | 你指定的。新架構（Fabric／TurboModules）預設開啟 |
| 執行方式 | **Development build**（`expo-dev-client`）+ EAS Build | RevenueCat 和自訂原生模組都不能在 Expo Go 裡跑 |
| 路由 | expo-router | 檔案即路由，Expo 官方推薦 |
| 相簿讀取 | **expo-media-library `58.0.x`（新版 API）** | 你指定的。`Query` 可分頁、排序、用時間過濾；`Asset.delete([...])` 可批次刪除 |
| 自訂原生功能 | **本機 Expo 模組 `modules/photo-actions`**（Kotlin + Swift） | 系統垃圾桶、隱藏、批次加最愛、讀檔案大小，這些 expo-media-library 都沒有，見 §3.3 |
| 顯示照片 | expo-image | iOS 讀得懂 `ph://`、Android 讀得懂 `content://`，有記憶體／磁碟快取 |
| 縮圖與雜湊前處理 | expo-image-manipulator `58.0.x` | iOS 原始碼確認：讀 `ph://` 時會用 PhotoKit 直接縮圖，不用先解整張原圖 |
| PNG 解碼（雜湊用） | `fast-png`（純 JS） | 只解 32×32 的小圖，Hermes 上很快 |
| 手勢與動畫 | react-native-gesture-handler + react-native-reanimated | 卡片拖曳要在 UI thread 跑到 60fps |
| 本機資料庫 | **expo-sqlite** + Drizzle ORM | 一個資料庫檔。Drizzle 給 TypeScript 型別和 migration；schema 見 `schema.sql` |
| 付費 | **react-native-purchases `11.x`** + react-native-purchases-ui | 你指定的。RevenueCat 在它的伺服器驗證收據，所以我們不用架後端 |
| 上鎖相簿解鎖 | expo-local-authentication | 指紋／臉部／裝置密碼 |
| 防截圖 | expo-screen-capture | 上鎖相簿畫面禁止截圖，最近使用的 App 清單也看不到內容 |
| 震動回饋 | expo-haptics | 滑過門檻時給一下回饋 |
| 錯誤回報 | Sentry（`@sentry/react-native`），**關閉截圖與 breadcrumb 裡的檔名** | 唯一會把資料送出手機的地方，只送當機資訊 |
| 測試 | Jest（邏輯）+ Maestro（實機 E2E） | 雜湊與分組演算法用 Jest 測；滑動、系統視窗用 Maestro |

**沒有**：後端、資料庫伺服器、帳號、email、雲端儲存、排程伺服器。

## 2. 本機資料庫

12 張表，全部在手機的 App 沙盒裡（`schema.sql`）。

| table | 用途 |
| --- | --- |
| `assets` | 系統相簿的鏡像索引（月份、類型、是否在 iCloud…），算進度和排程雜湊用 |
| `decisions` | 每張照片的決定：`keep` / `archive` / `hide` |
| `archive_items` | 封存區；送出刪除後記錄結果，App 自己存一份縮圖 |
| `delete_batches` | 每次「清空封存區」對應一次系統確認視窗，記錄用了哪種刪法、成功幾張 |
| `hidden_items` | 隱藏的照片。iOS 只記 ID；Android 記上鎖相簿裡的檔案路徑和原本的檔名、資料夾、拍攝時間 |
| `photo_hashes` | 感知雜湊（pHash + dHash），照片編輯過就重算 |
| `similar_groups` / `similar_group_members` | 相似照片組 |
| `undo_log` | 復原紀錄，留最近 50 筆 |
| `daily_quota` | 每日免費滑動次數，以使用者當地日期為鍵 |
| `pending_favorites` | Android 加最愛的佇列 |
| `app_kv` | 設定（滑動方向、onboarding、上次同步時間） |

**存取規則**：沒有伺服器，所以沒有 RLS。資料只在 App 沙盒裡，作業系統保證其他 App 讀不到。
資料存取全部經過 `src/db/repo.ts`，畫面元件不直接寫 SQL。

**刻意和伺服器版 schema 不同的地方**：
- 主鍵直接用系統相簿的資產 ID，不另外產生 uuid。
- 時間存 UTC 毫秒（SQLite 沒有 timestamptz）。
- 沒有 `user_id`，也不存錢。

## 3. 「API」：沒有後端，改成三層介面

### 3.1 App 內服務層（`src/services/*`），對應 recon 的流程

| function | does | input | output | flow |
| --- | --- | --- | --- | --- |
| `library.sync()` | 用 `Query.exeForMetadata()` 分頁讀相簿，更新 `assets`；找不到的標 `missing_since` | — | 新增／移除數 | 啟動、回到前景、相簿變更事件 |
| `library.sections()` | 依 `section_key` 列出月份分區與進度 | — | `Section[]` | F01、F02 |
| `deck.next(section, n)` | 取下一批還沒決定的照片，預載縮圖 | sectionKey、n | `Asset[]` | F02 |
| `deck.decide(id, keep\|archive\|hide)` | 寫入決定、扣額度、記 undo；hide 會觸發 `hide.enqueue` | assetId、decision | — | F02、**F08** |
| `deck.undo()` | 還原上一筆（包含取消隱藏） | — | 被還原的 assetId | F03 |
| `quota.status()` / `quota.consume()` | 每日額度；訂閱用戶不限 | — | `{used, limit, bonus}` | F02 → S07 |
| `archive.list()` / `archive.restore(ids)` | 封存區列表、還原 | ids | — | F05、F06 |
| `archive.empty(ids)` | **依平台**呼叫刪除（§4.1），每 500 張一批，寫 `delete_batches` | ids | `{confirmed, cancelled, failed}` | F05 |
| `hide.enqueue(id)` / `hide.flush()` | 隱藏佇列；滑完一段或離開畫面時一次送出（§4.2） | ids | 結果 | **F08** |
| `hide.list()` / `hide.unhide(ids)` | 上鎖相簿列表、搬回相簿 | ids | 新 assetId 對應 | **F09** |
| `similar.scan()` | 背景計算雜湊（§5） | — | 進度 | — |
| `similar.groups(section?)` / `similar.resolve(groupId, keepIds)` | 列出相似組；選好之後其他的進封存 | — | — | F04 |
| `favorites.toggle(id)` / `favorites.flush()` | iOS 立即生效；Android 排隊再批次送出（§4.6） | id | — | 雙擊 |
| `billing.*` | 見 §3.2 | | | S04、S07 |

### 3.2 RevenueCat（取代「付款 webhook」）

| call | 用途 |
| --- | --- |
| `Purchases.configure({ apiKey })` | **Android 和 iOS 是兩把不同的 public SDK key**，依 `Platform.OS` 選。沒有登入，用匿名 App User ID |
| `getOfferings()` | 取方案和**當地幣別價格**。價格一律由商店提供，不寫死在 App 裡 |
| `purchasePackage(pkg)` | 購買 |
| `restorePurchases()` | 還原購買。**iOS 審核要求付費牆上一定要有這個按鈕** |
| `addCustomerInfoUpdateListener` | entitlement `pro` 一變就解鎖或上鎖 |
| `RevenueCatUI.presentPaywallIfNeeded` | 可選：用 RevenueCat 後台設計付費牆，不用重送審就能改文案 |

- **Webhooks in / out**：沒有。收據驗證、續訂、退款都由 RevenueCat 伺服器處理。
  我們只要在 RevenueCat 後台填 Google Play 的 service account 和 App Store Connect 的 API key。
- **離線**：SDK 會快取 `CustomerInfo`，離線時也知道是不是訂閱用戶。

### 3.3 自訂原生模組 `modules/photo-actions`（Expo Modules API）

expo-media-library 做不到下面這些事（原始碼確認），所以自己寫一個很小的本機模組。

| function | Android 實作 | iOS 實作 |
| --- | --- | --- |
| `trash(ids)` | `MediaStore.createTrashRequest(uris, true)`，一次確認一批（Android 11+） | 不需要。直接用 `Asset.delete()`，本來就會進「最近刪除」 |
| `untrash(ids)` | `createTrashRequest(uris, false)` | iOS 沒有 API，只能請使用者到「照片」App 自己救回 |
| `setHidden(ids, hidden)` | 不適用，Android 改用 vault | `PHAssetChangeRequest.isHidden`，一次 `performChanges` 處理一批 |
| `listHidden()` | 不適用 | `PHFetchOptions.includeHiddenAssets = true`，只取 `isHidden` 的照片 |
| `moveToVault(ids)` | 1) 把 `content://` 的檔案串流複製到 `filesDir/vault/`，算 sha256；2) 一次 `createDeleteRequest` 刪原檔；3) 使用者取消就刪掉複本（rollback） | 不適用 |
| `restoreFromVault(items)` | 用 `MediaStore.insert` 寫回原本的 `RELATIVE_PATH`、`DISPLAY_NAME`、`DATE_TAKEN`，回傳新 ID；**寫自己的新檔不需要確認視窗** | 不適用 |
| `setFavorites(ids, fav)` | `MediaStore.createFavoriteRequest(uris, fav)`，一次確認一批 | 用 expo-media-library 的 `setFavorite` 就可以，不跳視窗 |
| `fileSizes(ids)` | 查 MediaStore 的 `SIZE` 欄位，便宜 | 見 §4.4，沒有便宜又正式的 API |

### 3.4 背景工作（沒有伺服器，所以都在手機上）

| job | 什麼時候跑 | 做什麼 |
| --- | --- | --- |
| 相簿同步 | 啟動、回到前景、`MediaLibrary.addListener` 事件 | 更新 `assets`，偵測被別的 App 刪掉或新增的照片 |
| 雜湊計算 | App 在前景、而且使用者**沒在滑**的時候，一次 20 張 | §5 |
| 相似分組 | 一個月份的雜湊算完就分組 | §5 |
| 紀錄清理 | 每天第一次開啟時 | 刪除 40 天前已完成的封存／刪除紀錄與縮圖 |
| 額度重置 | 不用跑排程 | 讀取時用當地日期判斷 |

Android 可以再加 `expo-background-task`（底層是 WorkManager，最快 15 分鐘一次）在充電時算雜湊。
iOS 的背景執行由系統決定時機，**不能指望**，所以雜湊主要還是在前景算。

## 4. Android 和 iOS 不一樣、要分開處理的地方

這是這份文件最重要的一節。每一項都標了來源：**原始碼**＝我讀過套件原始碼確認；
**文件**＝官方文件；**待實機確認**＝合理推測，必須在實機上驗證。

### 4.1 刪除（左滑 → 清空封存區）

| | Android 11+ | Android 10 以下 | iOS |
| --- | --- | --- | --- |
| expo-media-library 的 `Asset.delete([...])` 實際做的事 | `MediaStore.createDeleteRequest`，**永久刪除**（原始碼） | 直接刪檔，**沒有確認視窗，永久**（原始碼） | `PHAssetChangeRequest.deleteAssets`，進**「最近刪除」30 天**（文件） |
| 系統確認視窗 | 每批一次（原始碼：所有 URI 包成一個 request） | 沒有 | 每批一次，App 不能略過 |
| 使用者按取消 | 丟出 `PermissionsException`（原始碼） | — | 丟出錯誤（PhotoKit userCancelled） |
| 部分成功 | 整批成功或整批失敗 | **逐張刪、錯誤被吞掉**（原始碼 `runCatching`），要重新查一次才知道哪些真的刪了 | 整批 |
| 能不能從 App 救回 | 用 `createDeleteRequest` 不能；**改用 `trash()` 就可以**（30 天內 `untrash()`） | 不能 | 不能，只能到「照片」App |

**建議**：Android 11+ 的「清空」預設用 `photo-actions.trash()`（進系統垃圾桶），不要用 expo 的 `delete()`（永久刪除）。
理由：
- 兩個平台的行為會一致，都是「30 天內可以救回」。
- recon 裡使用者特別稱讚這點。
- 第一版原型就是這樣做的。

設定裡可以讓進階使用者改成「直接永久刪除」。
**注意**：系統垃圾桶裡的照片，Google 相簿和三星圖庫不一定看得到（各家圖庫有自己的垃圾桶），**待實機確認**。

**批次大小**：一次請求裡塞幾千個 URI，可能超過 Android Binder 的傳輸上限（約 1MB），**待實機確認**。
保守做法是每 500 張一批，畫面上寫「需要確認 3 次」。

### 4.2 隱藏（往上滑）

| | Android：App 內上鎖相簿 | iOS：系統「已隱藏」相簿 |
| --- | --- | --- |
| 原理 | 把檔案搬進 App 私有空間，再從系統相簿刪掉原檔 | 照片留在原處，只把 `isHidden` 設成 true |
| 系統確認視窗 | 有，刪原檔那一步，每批一次 | 會不會跳確認視窗**待實機確認**（刪除一定會跳；隱藏推測不會） |
| 照片還在系統相簿嗎 | **不在**（只在 App 裡） | 在，「已隱藏」相簿要 Face ID 才能打開（iOS 16+） |
| 備份 | **不會被 Google 相簿備份**；Android 的 App 自動備份上限 25MB，等於沒有 | 照常備份到 iCloud，隱藏狀態也會同步 |
| **解除安裝 App** | **上鎖相簿裡的照片會一起消失** ⚠️ | 沒影響 |
| 取消隱藏 | 用 `MediaStore.insert` 寫回原資料夾，**照片會拿到新 ID**，要更新 `hidden_items.restored_asset_id` | `isHidden = false`，ID 不變 |
| App 怎麼列出隱藏的照片 | 讀 `hidden_items`，縮圖存在私有空間 | 原生 fetch，設 `includeHiddenAssets`。系統鎖住「已隱藏」相簿時第三方 App 還讀不讀得到，**待實機確認**；讀不到就導去「照片」App |
| 開啟時要解鎖 | expo-local-authentication，畫面加防截圖 | 同樣在 App 內加一道鎖 |
| 「有限存取」模式 | 不受影響 | 只能隱藏使用者選過的照片 |
| 釋放空間 | **不會**（只是搬位置），不能算進「省下 X GB」 | 不會 |

**Android 上鎖相簿的安全措施**（為了避免遺失照片，這些都是 must）：
1. **先複製、比對 sha256，確定一致才刪原檔**。使用者在系統視窗按取消，就刪掉複本，恢復原狀。
2. 第一次往上滑時跳說明：「照片會搬進 App 裡上鎖。**移除 App 會一起刪掉**，換手機前請先搬回相簿。」使用者勾選了解才繼續。
3. 上鎖相簿頁一直顯示「全部搬回相簿」按鈕。
4. 在 `AndroidManifest` 把 vault 資料夾排除在 Auto Backup 之外，避免半套備份造成誤會。
5. v1 依靠 Android 內建的檔案加密和 App 沙盒保護，不再另外加密；之後可以用 Android Keystore 做 AES-GCM 加密。

### 4.3 權限

| | Android | iOS |
| --- | --- | --- |
| 讀取 | 13+：`READ_MEDIA_IMAGES`／`READ_MEDIA_VIDEO`；12 以下：`READ_EXTERNAL_STORAGE` | `NSPhotoLibraryUsageDescription`，要的是 read-write 權限 |
| 只給部分照片 | 14+：`READ_MEDIA_VISUAL_USER_SELECTED`，要重新請求才能多選 | `limited`，用 `presentPermissionsPicker()` 讓使用者多選 |
| 修改／刪除別人的照片 | 每次都要系統確認（每批一次） | 有 read-write 權限就能改；刪除另外有系統確認 |
| **商店政策** | **Google Play「相片和影片權限」政策**：要申請 `READ_MEDIA_IMAGES`，必須在 Play Console 填聲明，說明核心功能需要完整存取。整理相簿應該符合，但**送審前要確認** | 說明文字必須講清楚用途，否則會被退件 |

### 4.4 檔案大小與「省下多少空間」

| | Android | iOS |
| --- | --- | --- |
| expo-media-library 有沒有提供檔案大小 | 沒有（原始碼：`AssetInfo` 沒有 size） | 沒有 |
| 怎麼拿 | `photo-actions.fileSizes()` 查 MediaStore `SIZE`，便宜 | 沒有便宜又正式的 API：正式做法要串流讀整個檔案（iCloud 照片會觸發下載）；常見的 `PHAssetResource` `fileSize` 是非公開欄位，有被退件的風險 |
| 建議 | 準確數字 | 只對封存區的照片計算；算不出來就依解析度估算，顯示「約」 |
| 空間什麼時候真的釋放 | 用 trash：30 天後；用 delete：立刻 | 「最近刪除」30 天後；iCloud 照片刪掉省的是雲端空間 |

所以慶祝畫面（S11）要寫「**將**釋放約 X GB」，並說明 30 天的事，不能寫成「已釋放」。

### 4.5 iCloud／雲端照片

- **iOS**：開了「最佳化 iPhone 儲存空間」，原圖只在 iCloud（`getIsInCloud()`）。
  縮圖工具讀 `ph://` 時設了 `isNetworkAccessAllowed = true`（原始碼），**算雜湊可能會下載原圖**，消耗流量和電量。
  做法：
  - 算雜湊時要的尺寸很小，PhotoKit 通常會用本機的縮圖版本。
  - 「行動網路下跳過 iCloud 照片」做成預設開啟。
  - 下載失敗就記在 `photo_hashes.error`，之後再試。
- **Android**：已經備份到 Google 相簿、又從手機移除的照片，MediaStore 裡根本沒有，App 看不到，也不用處理。

### 4.6 加入最愛（雙擊）

| | Android 11+ | iOS |
| --- | --- | --- |
| expo-media-library `setFavorite` | **每張照片跳一次系統確認**（原始碼：先 `requestMediaLibraryWritePermission`） | 不跳視窗，直接加入系統「喜好項目」相簿 |
| 做法 | 雙擊先記在 `pending_favorites`，卡片上立刻顯示愛心；滑完一段時用 `createFavoriteRequest` **一次確認一批** | 直接呼叫 |
| 其他圖庫看得到嗎 | 寫的是 MediaStore `IS_FAVORITE`；Google 相簿、三星圖庫可能有自己的最愛清單，**不一定同步**（expo 文件也這麼說） | 「照片」App 看得到 |

### 4.7 照片 ID、類型、相似照片

| | Android | iOS |
| --- | --- | --- |
| ID | MediaStore `_ID`（數字），網址是 `content://` | `localIdentifier`（例如 `ABC…/L0/001`），網址是 `ph://` |
| ID 會變嗎 | 檔案被搬動或重新掃描時可能會變；**從上鎖相簿搬回後一定會變** | 穩定 |
| 螢幕截圖 | 沒有類型欄位，從檔名（`Screenshot_`）或資料夾推測 | `MediaSubtype.SCREENSHOT` |
| Live Photo | 沒有（Google／三星的動態相片會被當成一般照片） | 有（`getLivePhotoVideoUri()`），刪除時照片和影片會一起刪 |
| 連拍 | 沒有欄位 | PhotoKit 有連拍 ID，但 expo 沒提供；靠相似偵測處理 |
| HEIC | Android 9+ 能解，舊機可能慢 | 原生支援 |

### 4.8 手勢與畫面

- **Android**：從螢幕下緣往上滑是「回主畫面」的系統手勢，可能會跟「往上滑隱藏」打架。
  做法：手勢只從**卡片上**開始算，卡片下緣離螢幕底部留出系統手勢區（用 safe area inset）；往上的門檻設高一點。
  另外，Android 的返回手勢從左右邊緣開始，卡片左右也要留邊。
- **iOS**：滑動頁要關掉導覽列的「從左邊緣滑回上一頁」（`gestureEnabled: false`），不然左滑會變成返回。
- **Android 15+ 強制 edge-to-edge**：所有畫面都要處理 safe area。
- 誤觸保護：往上滑要比左右滑更明確（比較長的距離＋速度），並顯示「隱藏」覆蓋層，讓使用者在放手前看清楚。

### 4.9 付費（RevenueCat 底下兩邊還是不同）

| | Google Play | App Store |
| --- | --- | --- |
| 商品設定 | 訂閱 ID + **base plan** + **offer**（免費試用要做成 offer） | 產品 ID + 訂閱群組 + **introductory offer** |
| 試用資格 | 依 Google 帳號，每個訂閱只能用一次 | 依 Apple ID，每個訂閱群組一次 |
| 還原購買 | 會自動同步，但還是保留按鈕 | **審核規定一定要有「還原購買」按鈕** |
| 管理訂閱 | 打開 Play 商店的訂閱頁（用 `managementURL`） | 打開 App Store 的訂閱頁 |
| 測試 | 授權測試人員 + 內部測試軌；**App 要先上傳到測試軌，才能測購買** | Sandbox／TestFlight，或本機的 StoreKit 設定檔 |
| 訂閱說明 | 付費牆要寫清楚價格、續訂週期、怎麼取消 | 準則 3.1.2，要求同上，更嚴格 |
| 資料揭露 | Data safety 表單：要申報 RevenueCat 收集的購買紀錄和 App User ID | 隱私營養標籤：同上 |

### 4.10 背景執行

- **Android**：WorkManager（`expo-background-task`）可以在充電＋閒置時算雜湊。
- **iOS**：`BGTaskScheduler` 由系統決定時機，可能很久才跑一次。
- 兩邊都以「前景、使用者沒在滑的時候」算雜湊為主，背景只是加分。

## 5. 相似照片偵測（手機本機）

**流程**：
1. 用 `ImageManipulator.manipulate(uri).resize({ width: 32, height: 32 })`，輸出 PNG base64，最長邊先限制在 64px。
2. 用 `fast-png` 解碼，轉成灰階。
3. 算 **pHash**：32×32 的 DCT，取左上 8×8 的係數和中位數比較，得到 64 bit。
4. 同時算 **dHash**：9×8，64 bit，作為第二道確認。
5. 存進 `photo_hashes`。

**分組**：不做 n² 兩兩比較。
1. 照片依拍攝時間排序，只跟**前後 10 分鐘內**的照片比（連拍、重拍幾乎都在這個範圍內）。
2. pHash Hamming 距離 ≤ 10 **而且** dHash ≤ 12，就算相似，用 union-find 串成組。
3. 門檻要用你自己的照片調整，所以做成設定值。Jest 測試要包含：同一個場景的連拍、截圖、同一份文件的不同頁、完全不同的照片。
4. 「完全重複」（距離 0 而且解析度相同）不受時間範圍限制，用雜湊值直接查。

**效能估算**（**待實機量測**）：
- 每張的時間主要花在原生解碼和縮圖，估計 20–80ms。2 萬張大約 7–27 分鐘。
- 一次 20 張，每張算完讓出主執行緒；使用者在滑動時暫停。
- 依月份算，使用者正在整理的月份優先。
- 進度顯示在首頁，例如「相似照片分析中 37%」。

**推薦最佳那張**（v1 簡單版）：解析度最高、檔案最大、不是截圖，再加上最近被設成最愛。v2 可以加清晰度（拉普拉斯變異數）判斷。

## 6. The parts that bite

- **時區**：月份分區和每日額度都用使用者「當地」日期；拍攝時間存 UTC。使用者出國，分區不能跳來跳去，所以 `section_key` 第一次算出來就固定。
- **冪等**：清空封存區時 App 被系統殺掉 → `delete_batches.status = 'pending'`。下次開啟時重新查那些照片還在不在，修正狀態，絕對不要自動再送一次刪除。
- **競態**：
  - 使用者在系統確認視窗出現時切出去，回來時 App 會觸發「回到前景就同步」→ 系統操作進行中先暫停同步（第一版原型已經處理過這個坑）。
  - 照片被別的 App 刪掉 → 同步時標 `missing`。
  - 雜湊算到一半照片被刪 → 忽略錯誤。
- **額度被繞過**：額度存在本機，改系統時間或清資料就能重來。可以接受，不值得為這個架後端；訂閱才是收入來源。
- **大量資料**：10 萬張照片的人存在。所有列表都要分頁或虛擬化，`assets` 同步要分批寫入，用 transaction。
- **檔案大小限制**：Android 上鎖相簿複製大影片要用串流，不能整個讀進記憶體。複製前檢查剩餘空間（要多一份檔案的空間）。
- **離線**：整個 App 都能離線用，只有購買需要網路。
- **GDPR／個資**：沒有伺服器就沒有使用者資料可以刪。設定裡提供「清除所有 App 資料」。Sentry 要關掉會包含檔名的 breadcrumb。
- **上架 4.3／重複內容**：功能上跟 Picnic 太像會被拒。差異化要在送審前定好（`/replica-entrepreneur`）。「往上滑進上鎖相簿」本身就是一個可以寫進商店頁的差異點。

## 7. Build order

每個里程碑列出畫面（S-ID 來自 recon，S15、S16 是新增的）、資料表、服務。

**0. 骨架**（半天）
- `create-expo-app`（TypeScript）、expo-router、dev client、EAS 設定。
- 空的 `modules/photo-actions`，Android 先能編出 APK。

**1. Vertical slice**（最先做，證明整條路走得通，醜沒關係）
- 畫面：S02 權限 → S06 滑動 → S09 封存區 → S10 系統確認。
- 資料表：`assets`、`decisions`、`archive_items`、`delete_batches`、`app_kv`。
- 服務：`library.sync`、`deck.next/decide/undo`、`archive.list/empty`。
- 原生：Android `trash()`。
- 驗收：在一支 Android 11+ 實機上，左滑 3 張 → 清空 → 系統視窗只跳 1 次 → 照片進系統垃圾桶。

**2. Must-haves**（依 `features.csv`）
- 滑動：預載下一張、按鈕操作、保留過的不再出現、Undo（S06）。
- 封存區：還原、按「不允許」的處理、30 天說明（S09、S10）。
- **往上滑隱藏**：
  - Android 上鎖相簿（S15）：`moveToVault`／`restoreFromVault`、sha256 驗證、rollback、第一次使用的警告、解鎖、防截圖。
  - iOS `setHidden`／`listHidden`。
  - 資料表 `hidden_items`。
- 相似照片：雜湊、分組、比較畫面（S08）；資料表 `photo_hashes`、`similar_*`。
- 權限的各種狀態：拒絕、部分存取（S02）。

**3. Should-haves**
- 月份分區（S05）、分區完成（S12）、「將釋放 X GB」（S11，加上 `fileSizes`）。
- 雙擊加最愛：iOS 直接呼叫；Android 用佇列 + `setFavorites`。
- 影片／Live Photo 卡片。
- 每日額度（S07）、RevenueCat 付費牆（S04）、onboarding（S01、S03）。

**4. iOS**（Play 上架之後）
- 換到 iOS 實機，逐項檢查 §4 標示「待實機確認」的項目。
- StoreKit 商品、還原購買按鈕、隱私營養標籤。

**5. Could-haves**
- streak、On This Day、截圖專區、統計。

**6. replica-entrepreneur 找到的修正**
- 例如：不放廣告、提供買斷方案、先試滑再出付費牆。

新增畫面：
- **S15 上鎖相簿**（Android）／隱藏照片列表（iOS）：解鎖、格狀縮圖、搬回相簿、全部搬回。
- **S16 隱藏說明**：第一次往上滑時出現，Android 會警告移除 App 會刪掉照片。

## 8. 待實機確認清單（Play 上架前要全部打勾）

- [ ] Android 系統垃圾桶裡的照片，Google 相簿／三星圖庫看不看得到
- [ ] 一次 `createTrashRequest` 塞幾張會出錯（Binder 上限）
- [ ] Google Play「相片和影片權限」聲明能不能通過
- [ ] 2 萬張照片的雜湊時間、耗電、記憶體
- [ ] 相似門檻在真實照片上的誤判率
- [ ] 上鎖相簿：搬進、搬回之後，檔名、資料夾、拍攝時間都正確
- [ ] 往上滑和 Android 系統回主畫面手勢不衝突
- [ ] （iOS 階段）隱藏會不會跳確認視窗；系統鎖住「已隱藏」相簿時 App 還讀不讀得到
