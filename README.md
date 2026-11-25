# 拾光・行程管理

以原生 HTML、CSS、JavaScript 製作的繁體中文行事曆。本週版本使用 Firebase Authentication 實作 Google 登入與登入狀態管理；行程儲存在目前瀏覽器的 localStorage，不連接資料庫。

## Firebase 設定

1. 在 [Firebase Console](https://console.firebase.google.com/) 建立專案，新增 Web app，複製 SDK 設定到 `firebase-config.js`。
2. Firebase Authentication > Sign-in method 啟用 Google。
3. Authentication > Settings > Authorized domains 加入 GitHub Pages 網域，例如 `yourname.github.io`。
4. 加入授權網域後，於 GitHub Pages 正式網址測試登入、重新整理、取消登入及登出。

本週不建立 Firestore，也不部署資料庫規則。Firebase Web 設定中的 API key 是前端公開設定；Google 密碼不會交給或儲存在本 APP。

## GitHub Pages 部署

將這個資料夾的內容上傳至 GitHub repository 的根目錄，並使用 `main` 分支。`.github/workflows/pages.yml` 會在推送後自動部署至 GitHub Pages。第一次部署前，進入 repository Settings > Pages，將 Build and deployment 的 Source 設為 GitHub Actions。完成後，於 Actions 確認 Deploy to GitHub Pages 工作成功，Pages 網址會顯示在部署結果中。

## 功能

- Google 登入與登出，Firebase Auth 管理登入狀態並提供 UID、顯示名稱與頭像。
- 月曆顯示每日行程、月計畫與年度計畫；點選事件可查看、修改或刪除。
- 每日行程必須選擇完整日期，時間可不填；月計畫選擇月份，年度計畫選擇年份。
- 新增行程可選一般、重要或最重要；每日行程及月曆事件依重要程度排序，重要行程優先顯示。
- 待辦事項由所有未完成的每日、月與年度計畫產生；完成度依已完成計畫數即時計算，行程只儲存在目前瀏覽器，不會跨裝置同步。
- 首次開啟會顯示可刪除的範例行程；Google 登入後可設定行事曆名稱，之後點選標題即可更改。
- 本機儲存後援、響應式版面與深色模式。
