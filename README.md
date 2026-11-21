# 拾光・行程管理

以原生 HTML、CSS、JavaScript 製作的繁體中文行程管理系統。Firebase Authentication 提供 Google 登入，Cloud Firestore 依登入者 UID 儲存各自的行程、計畫與待辦。未設定 Firebase 時，仍可使用瀏覽器本機儲存模式。

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
- 以月曆檢視每日行程與月／年度計畫；每日計畫的日期與時間可留空，月計畫與年度計畫可設定起訖期間。
- 管理待辦及完成進度。
- 本機儲存後援、響應式版面與深色模式。
