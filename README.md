# 拾光・行程管理

以原生 HTML、CSS、JavaScript 製作的繁體中文行事曆。Google 登入使用 Firebase Authentication，行程與完成狀態依登入者 UID 儲存於 Cloud Firestore；未登入時使用瀏覽器本機儲存。

## Firebase 設定

1. 在 [Firebase Console](https://console.firebase.google.com/) 建立專案，新增 Web app，複製 SDK 設定到 `firebase-config.js`。
2. Firebase Authentication > Sign-in method 啟用 Google。
3. Authentication > Settings > Authorized domains 加入 GitHub Pages 網域，例如 `yourname.github.io`。
4. 確認目標 Cloud Firestore 資料庫的 edition 與 location；建立或選定資料庫後，在此資料夾執行 `firebase deploy --only firestore:rules` 部署 `firestore.rules`。

Firestore 資料存放於 `users/{uid}/planner/state`，規則限制使用者只能讀寫自己的資料。Firebase Web 設定中的 API key 是用來識別專案的公開設定；資料存取權由 Authentication 與 Firestore Security Rules 保護。

## GitHub Pages 部署

將這個資料夾的內容上傳至 GitHub repository 的根目錄，並使用 `main` 分支。`.github/workflows/pages.yml` 會在推送後自動部署至 GitHub Pages。第一次部署前，進入 repository Settings > Pages，將 Build and deployment 的 Source 設為 GitHub Actions。完成後，於 Actions 確認 Deploy to GitHub Pages 工作成功，Pages 網址會顯示在部署結果中。

## 功能

- Google 登入與登出，行程資料依帳號同步至 Firestore。
- 月曆顯示每日行程、月計畫與年度計畫；點選事件可查看、修改或刪除。
- 每日行程必須選擇完整日期，時間可不填；月計畫選擇月份，年度計畫選擇年份。
- 待辦事項由所有未完成的每日、月與年度計畫產生；完成度依已完成計畫數即時計算，完成狀態會同步反映在月曆與 Firestore。
- 首次開啟會顯示可刪除的範例行程；Google 登入後可設定行事曆名稱，之後點選標題即可更改。
- 本機儲存後援、響應式版面與深色模式。
