# 滑滑整理（Swipe Clean）

一張一張滑過手機相簿的照片：

| 動作 | 結果 |
|---|---|
| **右滑**（或按綠色 ♥） | 保存 → 記住這張要留，之後不再出現 |
| **左滑**（或按紅色 🗑） | 刪除 → 先進 **App 垃圾桶**，再一起移到 **手機系統的垃圾桶** |
| 復原鍵 | 撤回上一次滑動 |

## 刪除流程（兩層垃圾桶）

1. 左滑後，照片先放進 **App 垃圾桶的「待移除」**，系統相簿裡還在，可以隨時還原。
2. 在主畫面上方的提示條或垃圾桶頁按 **「移到手機垃圾桶」**，App 會一次把照片送進系統垃圾桶：
   - **iOS**：「照片」App →「最近刪除」，30 天內可救回。
   - **Android 11 以上**：系統相簿的「垃圾桶」，30 天後系統自動清除；也能在 App 垃圾桶裡直接「救回」。
   - **Android 10 以下**：系統沒有垃圾桶，App 會先警告，確認後才永久刪除。
3. 送過去的照片會留在 App 垃圾桶的「已在手機垃圾桶」區（App 自己存了縮圖），方便回顧或救回。

> 為什麼不是每滑一張就直接丟進系統垃圾桶？
> iOS 和 Android 每次把照片移到系統垃圾桶都**一定會跳出系統確認視窗**，App 無法略過。
> 先集中在 App 垃圾桶、再一次送出，就只需要按一次「允許」。

## 開發

需要 [Flutter](https://docs.flutter.dev/get-started/install) 3.x。

```bash
cd mobile/swipe_clean
flutter pub get
flutter run            # 接上手機或開模擬器
flutter build apk      # Android 安裝檔
flutter build ipa      # iOS（需要 macOS + Xcode + Apple 開發者帳號）
```

主要檔案：

- `lib/app_store.dart`：狀態（待整理佇列、已保存、App 垃圾桶）與存檔
- `lib/system_trash.dart`：依平台把照片移到系統垃圾桶 / 救回
- `lib/widgets/swipe_card.dart`：可拖曳、會旋轉並顯示「刪除／保存」的卡片
- `lib/screens/`：主畫面、垃圾桶、已保存

照片只在手機上處理，不會上傳。相簿操作用的是 [photo_manager](https://pub.dev/packages/photo_manager)。
