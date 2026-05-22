# full-stack-intro-backend

參考分支：
```
https://github.com/NYCU-SDC/full-stack-intro-backend/tree/lecture-5
```

---

## 專案概述

這是一個 **FastAPI 後端**，搭配靜態前端頁面，實作個人雲端筆記（Digital Note）的完整全端應用程式。
後端提供 RESTful API 進行筆記的 CRUD 操作，資料庫使用 PostgreSQL，並以 Docker Compose 完整容器化。

---

## 專案架構

```
full-stack-intro-backend/
├── src/
│   ├── main.py                  # FastAPI 應用程式入口、CORS、路由註冊、啟動事件
│   ├── config/
│   │   └── database.py          # SQLAlchemy engine、SessionLocal、Base、get_db()
│   ├── models/
│   │   ├── user.py              # User ORM 模型（users 資料表）
│   │   └── note.py              # Note ORM 模型（notes 資料表，FK → users）
│   ├── schemas/
│   │   └── note.py              # Pydantic 請求／回應 schema
│   ├── routes/
│   │   └── notes.py             # HTTP 層，解析請求後委派給 service
│   ├── services/
│   │   └── note_service.py      # 商業邏輯與 DB 查詢
│   └── static/                  # 前端靜態檔案（由後端直接提供）
│       ├── index.html
│       ├── app.js
│       └── styles.css
├── docker-compose.yml
├── Dockerfile
└── requirements.txt
```

### 設計原則

- **Router 保持薄層**：route handler 只負責解析 HTTP 輸入，所有邏輯交給 service。
- **Service 擁有邏輯**：所有 DB 查詢與業務規則集中在 `note_service.py`。
- **SQLAlchemy Session** 透過 `Depends(get_db)` 注入，自動關閉。
- **Pydantic v2**：使用 `model_config = ConfigDict(from_attributes=True)` 與 `model_dump(exclude_unset=True)`。

---

## 資料庫 Schema

| 資料表  | 主要欄位 |
|---------|----------|
| `users` | `user_id` (PK)、`user_name`、`user_email` (unique) |
| `notes` | `note_id` (PK)、`user_id` (FK → users, CASCADE)、`title`、`content`、`note_date`、`is_pinned`、`is_archived`、`emotion` |

> 資料表會在應用程式**啟動時自動建立**（`Base.metadata.create_all`），無需手動執行 migration。

---

## 啟動方式

### Docker Compose（建議）

```bash
cd full-stack-intro-backend
docker compose up --build        # 啟動所有服務（backend + postgres + pgadmin）
docker compose up --build -d     # 背景執行
docker compose down              # 停止並移除容器
docker compose logs -f backend   # 即時查看後端 log
```

服務對外埠口：

| 服務 | URL |
|------|-----|
| FastAPI 應用程式 | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |
| 前端介面 | http://localhost:8000/ |
| pgAdmin | http://localhost:5050 （帳號：admin@example.com / password123） |
| PostgreSQL | localhost:5432 |

---

## API 端點

所有筆記端點需提供身份識別（Bearer Token 或 `?user_id`，詳見下方說明）。

| Method | Path | 說明 |
|--------|------|------|
| GET | `/` | 回傳前端 `index.html` |
| GET | `/health` | 健康檢查 |
| POST | `/notes` | 新增筆記 |
| GET | `/notes` | 列出筆記；支援 `?q=` 關鍵字搜尋、`?include_archived=true` 顯示封存筆記 |
| GET | `/notes/{note_id}` | 取得單筆筆記 |
| PATCH | `/notes/{note_id}` | 部分更新（只更新有傳入的欄位） |
| DELETE | `/notes/{note_id}` | 刪除筆記（回傳 204） |
| POST | `/images/upload` | 上傳圖片（multipart/form-data）；回傳 `{filename, url}`；需身份識別 |

---

## 身份識別機制

### Bearer Token（主要方式）

所有請求可在 Header 加入：

```
Authorization: Bearer <token>
```

目前支援兩種 **Demo OAuth Token 格式**：

| 格式 | 說明 |
|------|------|
| `user:<id>` | 直接指定 user_id，不綁定 OAuth provider |
| `<provider>:user:<id>` | 透過指定 provider 登入，支援 `google`、`github` |

**範例：**
```
Authorization: Bearer google:user:1
Authorization: Bearer github:user:42
Authorization: Bearer user:7
```

當使用 `<provider>:user:<id>` 格式且該 user 不存在於資料庫時，系統會**自動建立**該使用者（`user_name`：`Google User 1`，`user_email`：`google-1@oauth.local`）。

### 舊版 Query Parameter（向下相容）

若未提供 Bearer Token，仍可使用 `?user_id=<int>` 查詢參數：

```
GET /notes?user_id=1
```

若兩者皆未提供，回傳 `401 Unauthorized`。

---

## 筆記欄位與搜尋功能

### 新增欄位

| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| `is_pinned` | boolean | `false` | 釘選筆記，列表中置頂顯示 |
| `is_archived` | boolean | `false` | 封存筆記，預設從列表隱藏 |
| `emotion` | string / null | `null` | 情緒標籤，允許值：`happy`、`sad`、`neutral`、`excited`、`angry` |

建立或更新筆記時可帶入上述欄位；未傳入時維持預設值不變（`PATCH` 使用 `exclude_unset=True`，不會覆蓋未傳入的欄位）。

### 排序邏輯

`GET /notes` 回傳結果依序為：
1. 釘選筆記（`is_pinned=true`）優先
2. 同層內依 `note_id` 降序（即建立時間由新到舊）

### 關鍵字搜尋

```
GET /notes?q=<keyword>
```

對 `title` 與 `content` 做大小寫不敏感的部分比對（PostgreSQL `ILIKE`）。`q` 為空或未傳入時不套用搜尋。

### 封存篩選

```
GET /notes                        # 只回傳未封存的筆記（預設）
GET /notes?include_archived=true  # 同時回傳封存筆記
```

---

## 前端介面

前端以純 HTML / CSS / JavaScript 實作，由後端直接在 `GET /` 提供（`FileResponse`），靜態資源掛載於 `/static`。

### 功能

- **左側欄**：
  - 顯示目前登入使用者的筆記列表，點擊可載入筆記。
  - 釘選筆記在列表中置頂，並以 📌 前綴標示；封存筆記以 🗂 後綴標示並淡化顯示。
  - **搜尋列**：即時輸入關鍵字（300 ms debounce），透過 `?q=` 參數呼叫後端過濾。
  - **顯示封存** checkbox：勾選後於請求加上 `?include_archived=true`，讓封存筆記出現在列表中。
- **右側編輯區**：標題、內容輸入，支援新增、儲存、刪除。
  - **Preview / Edit 切換按鈕**：載入筆記時**預設以 Preview 狀態顯示**（Markdown 渲染，由 `marked.js` 處理）；點擊「Edit」切換到編輯模式，再次點擊「Preview」回到渲染視圖，原始 Markdown 文字不受影響。新建筆記時自動切回 edit mode。
  - **Insert Image 按鈕**（載入筆記後顯示）：選擇圖片後上傳至後端，並在游標位置插入 `![[uuid.ext]]` 語法；Preview 時會自動解析為圖片。
- **筆記元資料列（note-meta bar）**：載入筆記後顯示於編輯器頂部，提供：
  - **📌 Pin / Pinned** 按鈕：立即 PATCH `is_pinned`，切換釘選狀態。
  - **🗂 Archive / Archived** 按鈕：立即 PATCH `is_archived`，封存後從列表移除並清空編輯器。
  - **Mood** 下拉選單：選擇情緒標籤（`😊 Happy / 🤩 Excited / 😐 Neutral / 😢 Sad / 😠 Angry`），於存檔時一併送出。
- **工具列 Sign-in 面板**：
  - 下拉選單選擇 OAuth Provider（Google / GitHub）
  - 數字輸入框指定 Demo User ID
  - 點擊「Sign in」產生 Demo Bearer Token，儲存至 `localStorage`，並重新載入筆記列表。

### localStorage 儲存項目

| Key | 說明 |
|-----|------|
| `notes_oauth_token` | 目前的 Bearer Token |
| `notes_oauth_provider` | 目前選擇的 OAuth provider |
| `notes_oauth_user_id` | 目前的 OAuth User ID |

---

## 本次更新紀錄

### Commit 6 — Preview 預設開啟 + 切換筆記 Bug 修正

**異動檔案：** `src/static/app.js`

#### Bug 修正：切換筆記時 preview 卡住

在 preview 模式下點擊側邊欄其他筆記，preview 區塊會繼續顯示舊筆記的 HTML（新筆記內容已載入 textarea 但被舊 preview 遮住）。

根本原因：`loadNote()` 更新 `contentInput.value` 後未重新渲染 preview。

修正：在 `loadNote()` 的 `contentInput.value = note.content` 之後加入 preview 狀態處理：

```javascript
if (!isPreviewMode) {
  togglePreview();   // edit → preview（同時實現預設 preview）
} else {
  notePreview.innerHTML = marked.parse(preprocessMarkdown(contentInput.value || ""));
  // 重新渲染（修 bug）
}
```

#### 新行為：Preview 設為預設狀態

點擊側邊欄任意筆記，直接以 **Preview**（Markdown 渲染）狀態顯示。
需要編輯時點擊「Edit」手動切換，新建筆記仍自動切回 edit mode（`clearEditor` 行為不變）。

---

### Commit 5 — Markdown 預覽 + 圖片上傳

**異動檔案：** `src/routes/images.py`（新增）、`src/main.py`、`src/static/index.html`、`src/static/app.js`、`src/static/styles.css`、`src/static/marked.min.js`（新增）、`.gitignore`

#### `src/routes/images.py`（全新）

- 新增 `POST /images/upload` endpoint。
- 使用 `Depends(get_current_user_id)` 驗證身份（直接重用 `notes.py` 的 auth 邏輯）。
- MIME type 白名單（`image/jpeg`、`image/png`、`image/gif`、`image/webp`、`image/svg+xml`），不合法回傳 400。
- 5 MB 上限，超過回傳 413。
- 檔名以 `uuid4().hex + 副檔名` 儲存至 `src/static/uploads/{user_id}/`，回傳 `{"filename": "...", "url": "/static/uploads/{user_id}/..."}`。

#### `src/main.py`

- 新增 `app.include_router(images_routes.router)` 註冊圖片 router。

#### `src/static/marked.min.js`（全新）

- 從 jsDelivr 下載並本地打包 `marked.js`（v15），不依賴外部 CDN，容器離線也能運作。

#### `src/static/index.html`

- `<head>` 加入 `<script src="/static/marked.min.js"></script>`（在 `app.js` 之前）。
- 工具列新增 `#preview-button`（Preview / Edit 切換）與 `#image-upload-label`（含隱藏的 `#image-upload-input`）。
- 編輯器主體新增 `<div id="note-preview" class="content-preview" hidden>`（Markdown 渲染輸出區）。
- 版本號升至 `v=4`。

#### `src/static/app.js`

- 新增 DOM refs：`previewButton`、`imageUploadLabel`、`imageUploadInput`、`notePreview`。
- 新增全域狀態 `isPreviewMode = false`；於 module level 呼叫 `marked.use({ gfm: true, breaks: true })`。
- 新增 `preprocessMarkdown(text)` — 將 `![[filename]]` 替換為 `/static/uploads/${oauthUserId}/${filename}` 後再傳入 `marked.parse()`。
- 新增 `togglePreview()` — 切換 textarea / preview div 可見性；preview 模式下即時渲染 Markdown。
- 新增 `insertAtCursor(textarea, text)` — 在 textarea 游標位置插入文字並維持游標。
- `setMetaVisible(visible)` 連動 `imageUploadLabel.hidden`，確保 Insert Image 只在有效筆記載入後顯示。
- `clearEditor()` 呼叫 `if (isPreviewMode) togglePreview()` 確保切回編輯模式。
- `imageUploadInput` change 事件：以 `FormData` POST 至 `/images/upload`，成功後插入 `![[filename]]`；若在 preview 模式則自動切回 edit 再插入。

#### `src/static/styles.css`

新增以下樣式：

| 類別 | 說明 |
|------|------|
| `.secondary-button` / `.secondary-button.active` | Preview / Insert Image 按鈕；active（preview 模式中）時以 accent 色填充 |
| `.content-preview` | Markdown 渲染輸出區；與 `.content-input` 同寬、同 padding |
| `.content-preview h1/h2/h3` | 標題字級與字重 |
| `.content-preview pre` / `.content-preview code` | 程式碼區塊與行內 code 樣式 |
| `.content-preview table / th / td` | 表格邊框與 header 背景 |
| `.content-preview img` | 圖片最大寬度 100%、圓角 |

#### `.gitignore`

- 新增 `src/static/uploads/`，避免使用者上傳的圖片被提交至 git。

---

### Commit 4 — 前端 UI 控件（搜尋、釘選、封存、情緒）

**異動檔案：** `src/static/index.html`、`src/static/styles.css`、`src/static/app.js`

#### `src/static/index.html`

- 側邊欄新增 `#search-input`（搜尋列）與 `#show-archived` checkbox。
- 編輯器主體新增 `#note-meta` bar（預設 `hidden`），內含 `#pin-button`、`#archive-button`、`#emotion-select`。
- CSS / JS 版本號從 `v=2` 升至 `v=3`（強制瀏覽器重新載入靜態資源）。

#### `src/static/styles.css`

新增以下樣式：

| 類別 | 說明 |
|------|------|
| `.sidebar-search` | 搜尋列容器，位於側邊欄 header 下方 |
| `.search-input` | 搜尋輸入框樣式 |
| `.archived-toggle` | 「Show archived」checkbox label 樣式 |
| `.note-meta` | note-meta bar 容器（flex，wrap） |
| `.meta-button` / `.meta-button.active` | Pin / Archive 按鈕；active 時以 accent 色填充 |
| `.emotion-label` / `.emotion-select` | Mood 下拉標籤與選單 |
| `.note-item.is-pinned` | 釘選筆記標題前加 📌 前綴 |
| `.note-item.is-archived` | 封存筆記半透明（`opacity: 0.5`）並加 🗂 後綴 |

RWD 斷點（`max-width: 760px`）加入 `.note-meta` 縮排與 `.emotion-label` 靠左調整。

#### `src/static/app.js`

- 新增 DOM 引用：`noteMeta`、`pinButton`、`archiveButton`、`emotionSelect`、`searchInput`、`showArchivedCheckbox`。
- 新增 `setMetaVisible(visible)` — 切換 `#note-meta` 的 `hidden` 屬性。
- 新增 `setMetaState({is_pinned, is_archived, emotion})` — 同步更新按鈕文字、active class、下拉選單值。
- `withAuth(path, extraParams)` — 新增 `extraParams` 參數，將物件序列化為 query string 附加至 URL。
- 新增 `buildListParams()` — 讀取搜尋列與 checkbox 狀態，組成 `{q, include_archived}` 物件傳給 `withAuth`。
- `renderSidebar()` — 改用 `buildListParams()` 組 URL；list item 依 `note.is_pinned` / `note.is_archived` 加上對應 CSS class。
- 新增 `patchCurrentNote(fields)` — 對當前筆記送出 PATCH 請求，更新後同步 meta state 與側邊欄；封存後自動清空編輯器。
- `getEditorPayload()` — 加入 `emotion` 欄位（有值才附加）。
- `loadNote()` / `saveNote()` — 呼叫 `setMetaVisible(true)` + `setMetaState(...)` 更新 meta bar。
- `clearEditor()` — 呼叫 `setMetaVisible(false)` + `setMetaState()` 重置 meta bar。
- 新增事件監聽：`pinButton`、`archiveButton`（呼叫 `patchCurrentNote`）、`searchInput`（300 ms debounce → `renderSidebar`）、`showArchivedCheckbox`（→ `renderSidebar`）。

---

### Commit 1 — 靜態前端 + 資料庫自動初始化

**異動檔案：** `src/main.py`、`src/static/`（新增）

#### `src/main.py`

- 新增 `StaticFiles` 掛載，將 `src/static/` 目錄公開於 `/static` 路徑。
- `GET /` 由原本回傳 JSON `{"message": "Backend is running"}` 改為回傳 `index.html`（`FileResponse`）。
- 新增 `initialize_database()` 函式，呼叫 `Base.metadata.create_all(bind=engine)`，並透過 `@app.on_event("startup")` 在應用程式啟動時自動執行，確保資料表存在。

#### `src/static/`（全新）

- **`index.html`**：雙欄版面——左側筆記列表側邊欄、右側編輯器（標題 + 內容 textarea），工具列包含狀態文字與操作按鈕。
- **`app.js`**：前端邏輯，實作筆記的 CRUD 操作，透過 `fetch` 呼叫後端 API。
- **`styles.css`**：整體排版與元件樣式。

---

### Commit 3 — 筆記欄位擴充、關鍵字搜尋、測試補強

**異動檔案：** `src/models/note.py`、`src/schemas/note.py`、`src/services/note_service.py`、`src/routes/notes.py`、`src/tests/test_service.py`、`src/tests/test_schemas.py`、`docs/FEATURE_DESIGN.md`（新增）

#### 新增欄位

- `is_pinned`（Boolean）、`is_archived`（Boolean）、`emotion`（String 50, nullable）三個欄位加入 ORM model 與所有 Pydantic schema。
- `emotion` 使用 `EmotionType(str, Enum)` 進行驗證，合法值：`happy / sad / neutral / excited / angry`。

#### 列表查詢強化（`src/services/note_service.py`、`src/routes/notes.py`）

- `list_notes` 新增 `q`（關鍵字）與 `include_archived`（是否含封存）參數。
- 排序由 `note_id.desc()` 改為 `is_pinned.desc(), note_id.desc()`，釘選筆記置頂。

#### 測試（`src/tests/`）

新增 6 個測試（總計 23 個，全數通過）：

| 測試 | 檔案 |
|------|------|
| `test_update_note_updates_title_and_content` | `test_service.py` |
| `test_list_notes_excludes_archived_by_default` | `test_service.py` |
| `test_list_notes_with_keyword_applies_extra_filter` | `test_service.py` |
| `test_note_read_invalid_note_date` | `test_schemas.py` |
| `test_note_create_accepts_valid_emotion` | `test_schemas.py` |
| `test_note_create_rejects_invalid_emotion` | `test_schemas.py` |

#### 設計文件

新增 `docs/FEATURE_DESIGN.md`，記錄每個功能的設計決策依據（欄位型別選擇、ILIKE vs 全文索引、向下相容策略、測試策略）。

---

### Commit 2 — Demo OAuth Bearer Token 支援

**異動檔案：** `src/routes/notes.py`、`src/static/app.js`、`src/static/index.html`、`src/static/styles.css`

#### `src/routes/notes.py`（後端）

新增以下元件：

| 元件 | 說明 |
|------|------|
| `oauth2_scheme` | `OAuth2PasswordBearer(tokenUrl="/auth/token", auto_error=False)`，讓 Bearer Token 為非必填 |
| `parse_demo_oauth_identity(token)` | 解析 `user:<id>` 或 `<provider>:user:<id>` 格式，回傳 `(provider, user_id)` tuple |
| `ensure_oauth_user(db, provider, user_id)` | 若 provider token 對應的 user 不存在，自動新增至 DB |
| `get_current_user_id(...)` | FastAPI Dependency，取代原本所有端點的 `Query(...)` 參數，依序嘗試 Bearer Token → `?user_id`，兩者皆缺則拋出 `401` |

所有 5 個 route handler 的 `user_id` 參數由 `Query(...)` 改為 `Depends(get_current_user_id)`。

#### `src/static/app.js`（前端）

- 新增三個 `localStorage` key（`notes_oauth_token`、`notes_oauth_provider`、`notes_oauth_user_id`）的讀寫邏輯。
- `buildDemoProviderToken(provider)` 組合 `<provider>:user:<id>` 格式字串。
- `requestJson()` 中統一附加 `Authorization: Bearer <token>` header。
- `withAuth(path)` 輔助函式：有 token 時省略 `?user_id` query param。
- `authForm` submit 事件：讀取 provider 與 user ID，更新 token 並重新渲染側邊欄。
- 頁面初始化時從 `localStorage` 還原登入狀態。

#### `src/static/index.html`（前端）

- 在工具列的 `.actions` 區塊新增 `<form id="auth-form">` Sign-in 面板：provider `<select>`、user ID `<input type="number">`、「Sign in」提交按鈕。

#### `src/static/styles.css`（前端）

- 新增 `.auth-panel`、`.auth-input`、`.auth-user-input`、`.auth-button` 樣式。
- RWD 斷點下 `.auth-panel` 佔滿整行（`grid-column: 1 / -1`）。
