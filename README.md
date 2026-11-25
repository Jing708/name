# 拾光・行程管理

以原生 HTML、CSS、JavaScript 製作的繁體中文行事曆。Firebase Authentication 負責 Google 登入；Cloud Firestore 依登入者 UID 儲存行程與行事曆名稱。

## Firebase 設定

1. 在 [Firebase Console](https://console.firebase.google.com/) 建立專案並新增 Web app，將 SDK 設定放進 `firebase-config.js`。
2. Firebase Authentication > Sign-in method 啟用 Google，並在 Authorized domains 加入 GitHub Pages 網域，例如 `yourname.github.io`。
3. 建立 Cloud Firestore Standard 資料庫，然後部署 `firestore.rules`。
4. 在正式 Pages 網址登入 Google；新增、編輯、完成或刪除行程都會同步到 Firestore。

行程文件位於 `users/{uid}/planner/{planId}`，行事曆設定位於同一個使用者路徑下的 `meta` 文件。規則只允許本人讀寫自己的資料，並限制欄位、長度與型別。第一次登入時，若帳號尚無雲端行程，程式會把本機已建立的行程遷移一次；範例行程不會遷移。登出後，該帳號的雲端行程會從畫面隱藏但不會刪除；再登入同一帳號即可載入。訪客行程仍保存在本機瀏覽器。

Firebase Web 設定中的 API key 是前端公開設定；Google 密碼不會交給或儲存在本 APP。`firestore.rules` 是安全規則原型；正式分享前應再依實際資料需求審查及驗證。

## GitHub Pages 部署

GitHub Pages 已設定為直接從 `main` 分支根目錄發布。將程式推送到 `main` 後，GitHub Pages 會自動更新網站。若重新設定，請到 repository Settings > Pages，將 Source 設為 Deploy from a branch，分支選 `main`、資料夾選 `/(root)`。

## 功能

- Google 登入與登出，Firebase Auth 管理登入狀態並提供 UID、顯示名稱與頭像。
- 月曆顯示每日行程、月計畫與年度計畫；點選事件可查看、修改或刪除。
- 每日行程必須選擇完整日期，時間可不填；月計畫選擇月份，年度計畫選擇年份。
- 新增行程可選一般、重要或最重要；每日行程及月曆事件依重要程度排序，重要行程優先顯示。
- 待辦事項由所有未完成的每日、月與年度計畫產生；完成度依已完成計畫數即時計算，登入後的行程同步至 Firestore，可跨裝置載入。
- 首次開啟會顯示可刪除的範例行程；Google 登入後可設定行事曆名稱，之後點選標題即可更改。
- 訪客本機儲存、響應式版面與深色模式。
