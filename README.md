
# bioGO - 即時互動活動伺服器

本專案是一個使用 Node.js、Express 和 Socket.IO 建構的後端伺服器，旨在支援一個老師 (Teacher) 和多個學生 (Student) 之間的即時互動活動。伺服器採用動態插件架構，可以輕鬆擴展支援不同類型的活動。

## ✨ 功能特色 (Features)

*   **角色區分:** 明確區分老師和學生兩種連線角色。
*   **即時通訊:** 使用 Socket.IO 實現老師和學生之間的低延遲雙向通訊。
*   **狀態同步:**
    *   老師可以即時看到目前連線的學生列表。
    *   學生加入時，如果已有活動正在進行，會自動收到通知加入活動。
*   **活動生命週期管理:**
    *   老師可以啟動 (Launch) 特定活動。
    *   老師可以結束 (End) 目前正在進行的活動。
    *   所有學生會即時收到活動開始與結束的通知。
*   **動態活動插件:**
    *   活動邏輯（伺服器端）封裝在 `activities` 目錄下的獨立子目錄中（例如 `activities/quiz/logic.js`）。
    *   伺服器啟動時會自動掃描 `activities` 目錄，載入所有有效的活動插件。
    *   每個活動插件運行在獨立的 Socket.IO 命名空間 (Namespace) 下，避免事件衝突。
*   **靜態檔案服務:**
    *   提供主要的 Web 介面（位於 `public` 目錄）。
    *   為每個活動提供其專屬的靜態資源（CSS, Client-side JS，位於 `activities/<activity_name>/`）。
*   **輔助 API:**
    *   提供 API 生成 QR Code（方便學生掃描加入）。
    *   提供 API 列出所有可用的活動。
    *   提供 API 列出指定活動可用的資料集 (Sets)。

## 🛠️ 技術棧 (Technology Stack)

*   **後端:** Node.js
*   **Web 框架:** Express.js
*   **即時通訊:** Socket.IO
*   **輔助工具:**
    *   `fs`: 讀取檔案系統 (用於動態載入活動)
    *   `path`: 處理檔案路徑
    *   `./utils/qrcode-generator`: 自訂的 QR Code 生成工具

## 🏗️ 架構概覽 (Architecture Overview)

1.  **HTTP 伺服器 (Express):**
    *   處理基本的 HTTP 請求。
    *   提供靜態檔案服務 (`public/` 和 `activities/`)。
    *   定義 RESTful API 端點 (`/api/...`)。
2.  **WebSocket 伺服器 (Socket.IO):**
    *   建立在 HTTP 伺服器之上。
    *   **預設命名空間 (`/`):**
        *   處理使用者 (老師/學生) 的登入連線。
        *   管理老師和學生的基本狀態 (誰在線上)。
        *   處理由老師發起的全局活動控制事件 (`launchActivity`, `endActivity`)。
        *   向學生廣播活動狀態 (`activityLaunched`, `activityEnded`)。
        *   向老師同步學生列表 (`updateStudentList`)。
    *   **活動命名空間 (`/<activity_name>`):**
        *   由伺服器動態創建，每個活動插件對應一個。
        *   每個活動的具體即時互動邏輯 (例如：題目發送、答案接收、計分等) 在其對應的 `logic.js` 檔案中定義，並在此命名空間下處理。這樣可以隔離不同活動的事件，使結構更清晰。
3.  **活動插件 (Activity Plugins):**
    *   位於 `activities` 目錄下，每個子目錄代表一個活動。
    *   核心是 `logic.js` 檔案，它會被 `require` 並傳入該活動專屬的 Socket.IO 命名空間 (`nsp`) 進行初始化。
    *   活動可以包含自己的靜態資源 (CSS, JS, 圖片) 和資料集 (JSON 檔案)。

## 🔌 API 端點 (API Endpoints)

*   **`GET /api/qrcode?text=<url_or_text>`**
    *   **功能:** 生成指定文字內容的 QR Code。
    *   **參數:** `text` (Query Parameter) - 要編碼成 QR Code 的文字或 URL。
    *   **成功回應 (200):** `{"dataUrl": "data:image/png;base64,..."}`
    *   **錯誤回應 (400):** `{"error": "Missing text parameter"}` (缺少參數)
    *   **錯誤回應 (500):** `{"error": "..."}` (伺服器內部錯誤)
*   **`GET /api/activities`**
    *   **功能:** 列出所有伺服器上可用的活動名稱。
    *   **成功回應 (200):** `{"activities": ["quiz", "poll", "..."]}`
*   **`GET /api/activities/:activity/sets`**
    *   **功能:** 列出指定活動目錄下可用的資料集檔案名稱 (JSON 格式，排除 `questions.json`)。
    *   **參數:** `activity` (URL Parameter) - 活動的名稱 (對應 `activities` 下的目錄名)。
    *   **成功回應 (200):** `{"sets": ["set1", "set2", "..."]}`
    *   **錯誤回應 (404):** `{"error": "Activity not found"}` (找不到活動)
    *   **錯誤回應 (500):** `{"error": "..."}` (讀取檔案錯誤)

## ⚡ Socket.IO 事件 (Socket.IO Events)

### 預設命名空間 (`/`)

*   **連接時 (Server Receives):**
    *   客戶端連接時需在查詢參數中提供 `role` ('student' 或 'teacher')，學生還需提供 `studentId` 和 `name`。
    *   `socket.handshake.query`: `{ role: 'student' | 'teacher', studentId?: string, name?: string }`
*   **伺服器 -> 客戶端 (Server Emits):**
    *   `loginSuccess` (To connecting student): 確認學生登入成功。`{ studentId, name }`
    *   `updateStudentList` (To teacher): 當學生列表變更時，發送最新的學生列表給老師。`[{ studentId, name }, ...]`
    *   `activityLaunched` (To all students): 當老師啟動活動時，通知所有學生。`{ activity: string }`
    *   `activityEnded` (To all students): 當老師結束活動時，通知所有學生。
    *   `forcedDisconnect` (To specific student): 當老師移除或清除連線時，強制學生重新登入。
*   **客戶端 -> 伺服器 (Client Emits):**
    *   `launchActivity` (From teacher): 老師請求啟動一個活動。`(activityName: string)`
    *   `endActivity` (From teacher): 老師請求結束當前活動。`()`
    *   `removeStudent` (From teacher): 老師請求移除特定學生，並強制其重新登入。`(studentId: string)`
*   `clearAllStudents` (From teacher): 老師請求清除所有學生連線及所有活動命名空間連線，並強制其重新登入。`()`

### 活動命名空間 (`/<activity_name>`)

*   **注意:** 這些事件的具體名稱和行為定義在各個活動的 `activities/<activity_name>/logic.js` 檔案中。以下是一些可能的 *範例*：
    *   `getQuestion` (From student/teacher): 請求下一題。
    *   `newQuestion` (To clients in activity): 伺服器發送新題目。
    *   `submitAnswer` (From student): 學生提交答案。
    *   `showResults` (To clients in activity): 伺服器公布結果。
    *   `updateScore` (To specific student/teacher): 更新分數。

## 📁 目錄結構 (Directory Structure)

```
bioGO/ 
├── server.js # 主要伺服器邏輯 
├── package.json # 專案依賴與腳本 
├── node_modules/ # npm 安裝的依賴 
├── public/ # 主要的前端靜態檔案 (HTML, CSS, JS for login/dashboard) 
│ ├── index.html 
│ ├── style.css 
│ └── client.js 
├── activities/ # 活動插件目錄 
│ ├── quiz/ # 範例：測驗活動 
│ │ ├── logic.js # 測驗活動的伺服器端邏輯 (Socket.IO) 
│ │ ├── style.css # 測驗活動的前端樣式 
│ │ ├── client.js # 測驗活動的前端邏輯 
│ │ ├── set1.json # 測驗活動的資料集 1 
│ │ └── set2.json # 測驗活動的資料集 2 
│ ├── poll/ # 範例：投票活動 
│ │ ├── logic.js 
│ │ └── ... 
│ └── ... # 其他活動 
└── utils/ # 工具函數目錄 
└── qrcode-generator.js # QR Code 生成工具

```

## ⚙️ 環境要求 (Prerequisites)

*   Node.js (建議使用 LTS 版本)
*   npm 或 yarn (用於管理依賴)

## 🚀 安裝步驟 (Installation)

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd bioGO
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    # 或者使用 yarn
    # yarn install
    ```

## ▶️ 運行專案 (Running the Project)

```bash
node server.js
```

或者，如果在 package.json 的 scripts 中定義了 start 命令：
```
npm start
# 或者
# yarn start
```
伺服器將會啟動並監聽在環境變數 PORT 指定的端口，如果未指定，則預設為 3000。

# 如何新增活動 (How to Add a New Activity)
1. 在 activities 目錄下創建一個新的子目錄，名稱即為活動的唯一標識符（例如 wordcloud）。
2. 在該目錄下創建一個 logic.js 檔案。此檔案需要導出一個函數，該函數接收一個 Socket.IO 命名空間物件 (nsp) 作為參數。在此函數內編寫該活動的伺服器端即時通訊邏輯。

```
// activities/wordcloud/logic.js
module.exports = (nsp) => {
  console.log('Wordcloud activity namespace initialized');

  nsp.on('connection', (socket) => {
    console.log('A user connected to the wordcloud activity');

    // 在這裡處理 wordcloud 活動的特定事件
    socket.on('submitWord', (word) => {
      // ... 處理提交的詞語 ...
      nsp.emit('updateCloud', { /* 更新後的詞雲數據 */ });
    });

    socket.on('disconnect', () => {
      console.log('A user disconnected from the wordcloud activity');
    });
  });
};
```

3. (可選) 在活動目錄下添加該活動所需的前端靜態資源（如 client.js, style.css）。這些資源可以透過 /activities/<activity_name>/<filename> 的路徑被前端訪問。
4. (可選) 在活動目錄下添加該活動所需的資料集檔案（通常是 .json 格式）。這些資料集可以透過 /api/activities/<activity_name>/sets API 被列出，並在 logic.js 或前端 client.js 中讀取使用。
5. 重新啟動伺服器 (node server.js)，新的活動將會被自動載入。