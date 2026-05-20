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
| `notes` | `note_id` (PK)、`user_id` (FK → users, CASCADE)、`title`、`content`、`note_date` |

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

### 本機開發（不使用 Docker）

```bash
cp .env.example .env        # 設定 DATABASE_URL 指向本機 Postgres
pip install -r requirements.txt
uvicorn src.main:app --reload
```

---

## API 端點

所有筆記端點需提供身份識別（Bearer Token 或 `?user_id`，詳見下方說明）。

| Method | Path | 說明 |
|--------|------|------|
| GET | `/` | 回傳前端 `index.html` |
| GET | `/health` | 健康檢查 |
| POST | `/notes` | 新增筆記 |
| GET | `/notes` | 列出該使用者的所有筆記（依時間倒序） |
| GET | `/notes/{note_id}` | 取得單筆筆記 |
| PATCH | `/notes/{note_id}` | 部分更新（只更新有傳入的欄位） |
| DELETE | `/notes/{note_id}` | 刪除筆記（回傳 204） |

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

## 前端介面

前端以純 HTML / CSS / JavaScript 實作，由後端直接在 `GET /` 提供（`FileResponse`），靜態資源掛載於 `/static`。

### 功能

- **左側欄**：顯示目前登入使用者的筆記列表，點擊可載入筆記。
- **右側編輯區**：標題、內容輸入，支援新增、儲存、刪除。
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
