# Deploy checklist：Onceover（一次清）

Date：2026-11-12　Commit：見 git log　**Go from user：not yet**（preflight 沒過，本來就不能上線）

> **結論：現在不能上架。** 5 個 must-have 還沒做完（`parity.md`）。這一步只把「不需要你帳號」的部分準備好，
> 並列出你要做的事。照規則，Claude 不會買網域、不會輸入付款資料或密碼、不會貼正式金鑰，也不會在你說「可以」之前送出任何東西。

## Preflight（全部要過才能上架）

| 檢查 | 結果 | 說明 |
| --- | --- | --- |
| e2e | ✅ **14 / 14**（web 觸控，390×844，0 個 console 錯誤） | `npm run e2e:web`。這是 web 預覽＋假相簿，**不是實機** |
| 單元測試 | ✅ **35 / 35** | `npm test`，資料層跑真的 SQL（node:sqlite） |
| TypeScript | ✅ `tsc --noEmit` 沒有錯誤 | |
| 沒有未修的 S1／S2 bug | ✅ BUG-003（S2）、BUG-004（S1）都已修 | `bugs.md` |
| **parity：must-have 全部完成** | ❌ **8 / 13**，功能分數 46.1 | 缺：相似照片偵測、比較畫面、封存區總大小、iOS 實機刪除驗證、縮圖預載 |
| 品牌 sweep | ✅ `app/`、`site/` 都 Clean（exit 0） | 第一次跑抓到 tokens.json 的備註，已修 |
| 商店文字 | ✅ 中文、英文 listing 都 0 錯誤 0 警告 | `launch/listing.*.json` |
| 正式版建置 | ✅ Android release APK 建置成功（arm64-v8a＋x86_64，62 MB，除錯簽章） | 見下方 |
| 隱私權政策、條款上線，列出所有處理者 | ❌ 只有草稿（`launch/privacy-policy.md`），還沒上線；處理者：Google Play、Apple、RevenueCat（＋Sentry 如果加入） | |
| 刪除帳號 | ✅ 不適用：沒有帳號。設定頁要提供「清除所有 App 資料」（**還沒做**） | |
| favicon、標題、OG 圖、App icon 是自己的 | ❌ App icon、啟動圖、favicon 還是 Expo 預設圖；網站沒有 OG 圖 | 等 logo（`brand.md` 的 brief） |
| Google Play 照片權限聲明 | ❌ 還沒填 | 要申請 `READ_MEDIA_IMAGES`，Play Console 要填聲明說明核心功能 |

**任何一項沒過就停在這裡。** 目前沒過的：parity、隱私權政策上線、icon、Play 權限聲明。

## 正式環境（這個 App 沒有後端，所以比網站簡單）

| 項目 | 狀態 |
| --- | --- |
| 資料庫 | 不適用：資料只在使用者手機的 SQLite，沒有伺服器 |
| 環境變數 | 只有兩把 RevenueCat **public** SDK key（Android／iOS），放在 EAS 的環境變數，不 commit |
| 付款 | **不是 Stripe**：手機 App 必須用 Google Play Billing／StoreKit。商品見 `launch/pricing.md`（`onceover_full`，一次性） |
| OAuth、寄信網域 | 不適用：沒有登入、不寄信 |

## 網站（landing page，`mobile/site/`）

- 靜態頁，任何靜態主機都可以：**Cloudflare Pages**（建議，免費、自動 HTTPS）或 Netlify、GitHub Pages。
- 設定：連到這個 repo，**建置指令留空，輸出目錄填 `mobile/site`**。
- 網域（你買好之後，以 Cloudflare Pages 為例）：

  | record | name | value |
  | --- | --- | --- |
  | CNAME | `@`（Cloudflare 會自動攤平） | `<你的專案>.pages.dev` |
  | CNAME | `www` | `<你的專案>.pages.dev` |

  選一個當主網址（建議不帶 www），另一個轉址過去。
- **不需要 SPF／DKIM／DMARC**：網站和 App 都不寄信。候補名單用 Tally 或 Google 表單，信由它們寄。
- 隱私權政策放在 `https://<網域>/privacy`，Play Console 和 App Store Connect 都要填這個網址。

## Android 建置（這個環境實際跑的）

- `npx expo prebuild -p android` → `./gradlew assembleRelease`（arm64-v8a＋x86_64）。
- 一路遇到的環境問題，都已解決：
  - `expo install` 連不到 `api.expo.dev` → 改用 `EXPO_OFFLINE=1`
  - React Native 的 Gradle 外掛需要 **JDK 17**（機器上只有 21）→ 用 apt 安裝
  - Maven Central 429（請求太多）→ 重試
  - `repo.reactnative.dev` 被擋 → 加進網路允許清單
  - 我寫的原生模組少宣告 `androidx.activity` → 編譯抓到、已修
- 結果：**BUILD SUCCESSFUL**。`aapt2` 檢查：套件 `tw.onceover.app`、名稱 Onceover、含 `createTrashRequest`。
- 權限：把相依套件自動帶進來的 `READ_MEDIA_VIDEO`（v1 只處理照片，宣告了要多寫 Play 聲明）和
  `SYSTEM_ALERT_WINDOW`（開發用的懸浮視窗權限，正式版不該有）加進 `blockedPermissions` 擋掉，重建後確認已移除。
- 這個 APK 用的是**除錯簽章**，可以自己安裝測試，**不能上傳 Play**。正式版要用 EAS 或你自己的上傳金鑰簽章。

## 你要做的事（依順序）

1. **Google Play 開發者帳號**（一次性 US$25）：https://play.google.com/console
   - 新的個人帳號，正式上架前要先跑**封閉測試：至少 12 位測試者、連續 14 天**（以 Play Console 當時的規定為準）。
2. **Expo 帳號**（免費）：https://expo.dev，在 `mobile/app` 執行 `npx eas-cli@latest login`、`npx eas-cli@latest init`。
3. **RevenueCat 帳號**（免費額度）：
   - 建立專案和 Android App。
   - 上傳 Play service account JSON。
   - 建立 entitlement `full` 和 offering `default`，加一個 `lifetime` package。
   - 把 Android public SDK key 給我（public key 可以放進 EAS 環境變數；**不要**貼 secret key）。
4. **Play Console**：
   - 建立 App「Onceover 一次清」，套件名稱 `tw.onceover.app`。
   - 建立一次性商品 `onceover_full`。
   - 填 Data safety：照片不收集；RevenueCat 會收集購買紀錄＋匿名 ID。
   - 填照片權限聲明、內容分級、目標對象。
5. **建置並送到內部測試**：
   ```bash
   cd mobile/app
   npx eas-cli@latest build -p android --profile production     # 產生 .aab，EAS 幫你管理上傳金鑰
   npx eas-cli@latest submit -p android --profile production    # 送到 Play 內部測試軌（draft）
   ```
   `submit` 需要 `secrets/play-service-account.json`（從 Play Console 建立，**這個資料夾已在 .gitignore**）。
6. **iOS（Play 上架之後）**：
   - Apple Developer Program（US$99／年）。
   - `eas build -p ios --profile production`，然後 `eas submit -p ios` 送到 TestFlight。
   - 不需要 Mac：EAS 在雲端建置。但 iCloud 相關測試（`test-plan.md` C-1、C-2）要在 iPhone 上做。

## 上線後第一週要看的

- Play Console：當機率、ANR、評論（24 小時內回覆）。
- 錯誤回報：Sentry（**還沒加**；加的話記得關掉截圖和含檔名的 breadcrumb，並更新隱私權政策）。
- 不加分析 SDK（Data safety 才能誠實寫「不收集」）；需要的數字看 Play Console 和 RevenueCat。
- 你自己在手機上走一次完整流程：滑 → 封存區 → 移除 → 到系統垃圾桶確認 → 救回一張。

## 這一步準備好的檔案

- `mobile/app/eas.json`：development／preview（APK）／production（AAB）三種建置，送審到 Play 內部測試軌。
- `mobile/app/.gitignore`：加上 `secrets/`、`*.keystore`、`*.jks`。
- 這份 `deploy.md`。
