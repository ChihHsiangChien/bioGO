# 師生互動平台開發規格書

## 一、系統目標

- 教師筆電作為本地伺服器，學生使用 iPad 透過內網進入伺服器
- 所有互動以瀏覽器完成（無需安裝 app）
- 教師能派送活動，學生同步參與
- 支援 30 人以上即時互動
- 系統使用 **Node.js + Express + Socket.IO + React**

## 二、技術規格

- **後端**：Node.js + Express + Socket.IO
- **前端**：React（或選擇 Vue）
- **登入方式**：學生掃 QR code 連到登入頁
- **即時通訊**：使用 socket.io 維持連線與事件同步

## 三、系統功能模組

### 1. 基礎系統模組 (Core Modules)

- 產生學生登入的 QR code（指向學生登入頁）
- 顯示目前已登入學生名單
- 選擇活動進入對應的「教師儀表板」

### 2. 登入與連線管理 (Login & Connection)

- 掃描 QR code 進入登入頁
- 輸入姓名後建立連線
- 進入等待頁面，等待教師派送活動

### 3. 活動插件模組 (Activity Plugins)
- 支援多種互動形式，每種活動都是一個獨立插件：
-   - quiz-mc：多選題 (Kahoot 類型)
-   - poll：即時投票調查
-   - whiteboard：即時白板繪圖
-   - chat：簡易聊天室
-
- 活動插件標準結構（放置於 /activities 下）：
-   ├─ logic.js       # 匯出 function(nsp) 註冊 socket.io namespace 與事件處理
-   ├─ student.html   # 學生端靜態頁面
-   ├─ teacher.html   # 教師端靜態頁面
-   └─ 可選資源檔案 (questions.json、config.json 等)

- 教師可上傳題目或使用預設 JSON 題庫
- 題目包含：題幹、四個選項、正解、倒數時間
- 教師可手動啟動每題倒數，學生限時作答
- 學生提交答案後無法更改
- 教師端顯示：
  - 各學生作答情況（是否正確）
  - 作答速度前幾名
  - 答案統計圖（長條圖）

#### quiz-mc 資料格式（題庫 JSON 範例）

```json
[
  {
    "questionId": "q1",
    "question": "下列哪一項屬於初級消費者？",
    "options": ["老鷹", "兔子", "草", "狼"],
    "answer": 1
  }
]
```

## 四、系統檔案結構建議
```txt
project-root/
├── server.js            # 核心啟動檔，負責：
│                         # - 動態掃描 /activities 資料夾的插件
│                         # - 註冊對應的 socket.io namespace
│                         # - 提供 /api/qrcode 與 /api/activities 服務
├── package.json
├── spec.md              # 系統規格書 (本文件)
├── /public
│   ├── /student         # 學生端入口 (index.html)
│   └── /teacher         # 教師端儀表板 (index.html)
├── /activities          # 活動插件資料夾
│   ├── quiz-mc/         # 多選題插件示例
│   │   ├── logic.js
│   │   ├── student.html
│   │   ├── teacher.html
│   │   └── questions.json
│   ├── poll/            # 投票插件示例
│   │   ├── logic.js
│   │   ├── student.html
│   │   └── teacher.html
│   └── whiteboard/      # 白板插件示例
│       ├── logic.js
│       ├── student.html
│       └── teacher.html
└── /utils
    └── qrcode-generator.js  # QR code 產生工具
``` 
## 五、補充需求
學生登入後需綁定唯一 ID，便於記錄與重連

活動過程中學生與教師畫面需同步（題目開始/結束、統計資訊）

頁面需考慮平板使用：避免誤觸放大、誤捲動

若有更新，教師可下載新版資料夾解壓後覆蓋原活動資料夾即可更新

## 六、效能限制與優化
目標為在一般筆電支援 30 名學生同時互動

所有互動為文字與選項，圖片控制小於 500KB

socket 資料傳輸請盡量簡化 payload 結構與頻率

## 七、其他
請建立一個可以本地執行的 Node.js 專案，包含教師與學生的基本畫面，活動 quiz-mc 的完整邏輯與頁面互動，並說明如何執行與測試。若可以，請加入 mock data 與測試工具以模擬多人連線情境。
