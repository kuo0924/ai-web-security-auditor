# 上架計畫：Onceover（一次清）

## 上架前（現在 → Play 上架）
1. **把 must-have 做完**（`parity.md`：相似照片、隱藏、封存區總大小、縮圖預載），付費牆＋RevenueCat 一次性商品。
2. **實機測試**：`test-plan.md` 的 D-1～D-3（Android 11+ 清空 500 張、垃圾桶在各家圖庫的顯示、往上滑手勢）。
3. **候補名單**：landing page 先放 email 候補（可以用 Tally／Google 表單，**不要自己存 email 在 App 裡**）。
4. **Google Play 內部測試軌** → 封閉測試（Play 對新個人開發者帳號要求：**至少 12 位測試者連續 14 天**，以 Play Console 當時的規定為準）。
   這 12 位就是「第一批 10 個用戶」的來源。
5. **錯誤回報**：Sentry（關閉截圖與含檔名的 breadcrumb）。**不加分析 SDK**，Data safety 表單才能誠實寫「不收集」。
6. **商店素材**：截圖（實際 App 畫面，第一張放「沒有廣告・付一次」）、主視覺圖 1024×500、icon（`brand.md` 的 logo brief）。
7. **隱私權政策、支援網址**：`privacy-policy.md` 草稿；放在 landing page 網域下。

## 去哪裡找人（原版不滿的使用者在哪裡討論）
- **App Store／Google Play 評論區本身就是最大的聲音來源**（1725 則研究樣本裡，廣告和週訂閱是前兩名抱怨）。
  但**不能**去對手的評論區留言打廣告，也**不能**買或交換評論（違反商店政策，美國 FTC 2024 年規則也禁止假評論）。
- **Reddit**：r/iphone、r/Android、r/DataHoarder、r/declutter 等社群裡「photo cleaner app no subscription」這類討論串。
  **這次研究沒有實際讀 Reddit**（官方 API 需要帳號），所以這裡列的是要去找的地方，不是已經找到的串。
- **台灣**：PTT（iOS、Android 版）、Dcard 3C 版、Mobile01。以「我做了一個不放廣告、一次買斷的照片整理 App」的開發者身分發文，遵守各版的自介／廣告規定。
- **Product Hunt／Hacker News（Show HN）**：標題直接講修正：「Onceover – swipe-to-clean photos with no ads and a one-time price」。

## 第一批 10 個用戶，親自聊
- 從封閉測試的 12 人開始。每個人問三件事：
  1. 滑了幾張就停了？為什麼停？
  2. 有沒有怕刪錯？「封存區 → 系統垃圾桶」這段看得懂嗎？
  3. NT$290 一次買斷，會不會買？不會的話，多少會？
- 把回答記在 `replica/feedback.md` 的「自己的用戶」一節，跟研究資料分開。

## 上架後第一週
- 每天看 Play Console 的當機率（ANR、crash）和評論，24 小時內回覆每一則評論。
- **評分請求**：只在使用者第一次成功清空封存區之後才問（fixes F8），用 Play 的 In-App Review API。
