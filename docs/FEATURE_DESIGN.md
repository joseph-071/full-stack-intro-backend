# Feature Design — Note 擴充功能

本文件記錄本次新增功能的設計依據，說明每個決策背後的理由，作為程式碼修改的依據文件。

---

## Overview

本次新增項目：

| 項目 | 說明 |
|------|------|
| `is_pinned` 欄位 | 標記筆記為釘選，列表中置頂顯示 |
| `is_archived` 欄位 | 標記筆記為封存，預設從列表中隱藏 |
| `emotion` 欄位 | 為筆記附加情緒標籤（五種固定值） |
| 關鍵字搜尋 | `GET /notes?q=<keyword>`，搜尋 title 與 content |
| 封存篩選 | `GET /notes?include_archived=true`，顯示封存筆記 |
| Service 邏輯測試 | 同時更新 title + content、archived 篩選、keyword 篩選 |
| Schema 驗證測試 | 無效 note_date、合法/非法 emotion 值 |

---

## New Fields

### `is_pinned: Boolean`

**用途**：讓使用者將重要筆記置頂，不受新增時間影響。

**設計決策**：
- 型別選 `Boolean`（而非 priority 數字），因為置頂語意是二元的（釘選 / 未釘選），數字排序會增加 API 複雜度。
- `nullable=False, default=False`：所有既有筆記視為未釘選，不需 migration 補值。
- `server_default=text("false")`：確保直接對 DB INSERT 的舊資料（繞過 ORM）也能取得正確預設值。

**排序策略**：`order_by(Note.is_pinned.desc(), Note.note_id.desc())`
- 釘選筆記（`True=1`）排在未釘選（`False=0`）之前。
- 同層內仍依 `note_id` 降序，維持時間排序的一致性。

---

### `is_archived: Boolean`

**用途**：讓使用者隱藏不再常用的筆記，而不需刪除。

**設計決策**：
- 預設從列表隱藏（`include_archived=False`）：符合使用者直覺，封存就是「暫時移除視線」。
- 不採用「軟刪除（soft delete）」命名，因為封存筆記仍可復原並正常使用，語意上不是刪除。
- `nullable=False, default=False`：向下相容，既有筆記全部視為未封存。

**篩選邏輯**（在 `list_notes` service）：
```python
if not include_archived:
    query = query.filter(Note.is_archived == False)  # noqa: E712
```
`# noqa: E712` 是因為 SQLAlchemy 需要用 `==` 而非 `is` 比較 Column 值，linter 會誤報。

---

### `emotion: String(50), nullable`

**用途**：讓使用者記錄寫筆記時的情緒狀態，提供個人化的情緒追蹤。

**型別設計**：

| 方案 | 優點 | 缺點 |
|------|------|------|
| DB ENUM | DB 層強制約束 | 每次新增值需 migration，難以擴充 |
| DB String + Pydantic Enum | Pydantic 層驗證，DB 彈性儲存 | 理論上可繞過 API 直接寫入非法值（可接受） |

選擇 **DB `String(50)` + Pydantic `EmotionType(str, Enum)**：
- 新增情緒值只需改 Python 程式碼，不需 DB migration。
- `str` 繼承讓序列化輸出直接是字串（`"happy"`），JSON 不需額外轉換。
- `nullable=True`：情緒標籤是選填的，不強迫使用者標記。

**目前支援的值**：`happy`、`sad`、`neutral`、`excited`、`angry`

---

## Keyword Search

**API**：`GET /notes?q=<keyword>`

**實作**（在 `list_notes` service）：
```python
if q:
    query = query.filter(
        or_(
            Note.title.ilike(f"%{q}%"),
            Note.content.ilike(f"%{q}%"),
        )
    )
```

**ILIKE vs 全文索引（Full-Text Search）**：

| 方案 | 適用場景 | 本專案選擇理由 |
|------|---------|--------------|
| ILIKE | 小資料量、快速實作 | 個人筆記量不大，無需複雜索引 |
| PostgreSQL `tsvector` | 大量資料、多語言搜尋 | 過度設計，增加 migration 複雜度 |

**邊界行為**：
- `q=None`（未傳入）→ 不套用 keyword filter，回傳全部筆記（依 archived 設定）。
- `q=""`（空字串）→ Python `if q:` 為 `False`，等同未傳入，不觸發搜尋。
- 搜尋大小寫不敏感（ILIKE），`q="Hello"` 與 `q="hello"` 結果相同。

---

## Schema Versioning（向下相容）

新增的三個欄位（`is_pinned`、`is_archived`、`emotion`）在 `NoteCreate` 與 `NoteUpdate` 中**全部有預設值**：

```python
is_pinned:   bool = False          # NoteCreate
is_archived: bool = False          # NoteCreate
emotion:     EmotionType | None = None  # NoteCreate / NoteUpdate
```

**影響**：
- 現有客戶端不傳新欄位 → 使用預設值，不報錯。
- `NoteRead` 加入新欄位 → 現有客戶端若不讀這些欄位，不受影響。
- `NoteUpdate` 使用 `exclude_unset=True` → 未傳入的欄位不會被覆寫為 `None`。

**`emotion` 的語意限制**：`NoteUpdate.emotion=None` 預設值與「清除情緒標籤」語意重疊，
但因 `exclude_unset=True`，不傳 `emotion` 時不會寫入 `None`，只有明確傳 `"emotion": null` 才會清除。此行為可接受。

---

## Test Strategy

### 為什麼用 MagicMock 而非真實 DB？

| 考量 | MagicMock | 真實 DB（SQLite/PostgreSQL） |
|------|-----------|---------------------------|
| 速度 | 毫秒級 | 需起 DB 連線 |
| 隔離性 | 完全隔離，不受環境影響 | 需管理測試資料庫 |
| 測試範圍 | 只測 Python 邏輯（service 層） | 同時測 DB 行為 |
| 適用場景 | 單元測試（unit test） | 整合測試（integration test） |

本專案採用 **unit test**：驗證 service 層的 Python 邏輯（分支、條件、異常），
不驗證 SQL 的正確性（那是整合測試的範疇）。

### 各測試覆蓋的邏輯邊界

| 測試 | 覆蓋邏輯 |
|------|---------|
| `test_update_note_updates_title_and_content` | `exclude_unset=True` 同時處理兩個欄位 |
| `test_list_notes_excludes_archived_by_default` | `include_archived=False` 時確實多一次 `.filter()` 呼叫 |
| `test_list_notes_with_keyword_applies_extra_filter` | `q` 非空時確實多一次 `.filter()` 呼叫 |
| `test_note_read_invalid_note_date` | Pydantic 拒絕無法解析為 `date` 的字串 |
| `test_note_create_accepts_valid_emotion` | 合法 enum 值被接受並轉為 `EmotionType` |
| `test_note_create_rejects_invalid_emotion` | 非法 enum 值觸發 `ValidationError` |

---

## Frontend UI

本章節說明前端（`src/static/`）為呈現 `is_pinned`、`is_archived`、`emotion`、關鍵字搜尋、封存篩選所做的設計決策。

### Note-meta bar（`#note-meta`）

**設計決策：預設隱藏（`hidden`），載入筆記後才顯示**

- 新筆記尚未儲存時，沒有可操作的 `is_pinned` / `is_archived` 狀態，顯示 meta bar 意義不大。
- 儲存成功（`saveNote`）或載入既有筆記（`loadNote`）後，才呼叫 `setMetaVisible(true)` 顯示。
- 清空編輯器時（`clearEditor`）呼叫 `setMetaVisible(false)` 隱藏。

---

### 立即 PATCH（`patchCurrentNote`）

Pin / Archive 切換採用**即時送出 PATCH**，而非等待「Save」按鈕：

- 這兩個操作是狀態開關，語意上不屬於「編輯內容」，不應與 title / content 混在一起。
- 封存後列表不應再顯示該筆記（預設 `include_archived=False`），因此封存後自動重新渲染側邊欄並清空編輯器，提供即時反饋。

---

### 情緒標籤（Mood dropdown）

`emotion` 隨 Save 一起送出（在 `getEditorPayload()` 中附加），而非立即 PATCH：

- 情緒通常是與筆記內容一同記錄的，與 pin/archive 的「狀態管理」語意不同。
- 下拉選單值為空時不附加 `emotion` 欄位到 payload，避免意外清除既有標籤。

---

### 搜尋 Debounce（300 ms）

`searchInput` 的 `input` 事件以 300 ms debounce 觸發 `renderSidebar()`：

- 避免每個按鍵都發送一次 API 請求。
- 300 ms 在「反應夠快」與「不造成過多請求」之間取得平衡；個人筆記規模下不需更長延遲。

---

### 視覺指示器（CSS）

| 狀態 | 樣式 |
|------|------|
| 釘選（`is_pinned`） | `.note-item.is-pinned .note-title::before { content: "📌 " }` |
| 封存（`is_archived`） | `.note-item.is-archived { opacity: 0.5 }` + `.note-title::after { content: " 🗂" }` |

採用 CSS pseudo-element 而非在 JS 中直接修改文字，讓視覺邏輯與資料邏輯分離。

---

## Markdown Preview

本章節說明 Markdown 預覽功能的實作方式與設計依據（`src/static/`）。

### 為何選用客戶端渲染（marked.js）而非後端渲染

| 方案 | 優點 | 缺點 |
|------|------|------|
| 前端 marked.js | 後端零改動；`content` 欄位繼續存純文字 | API response 無法直接給 HTML |
| 後端 markdown 套件 | API 直接回傳 HTML | 需新增 requirements；DB 欄位語意不清 |

選擇前端渲染。`content` 欄位永遠是 Markdown 原始文字，API 保持 content-agnostic，未來換渲染器不需動後端。

---

### 為何本地打包 marked.min.js 而非 CDN

容器內網路不可假設；離線開發環境也能正常運作。打包為 `src/static/marked.min.js`，由 FastAPI StaticFiles 一同提供，不額外依賴外部服務。

---

### 為何採用切換模式（Edit / Preview）而非左右分割

- 左右分割在行動版螢幕（< 760 px）版面過窄，幾乎不可用。
- 現有 `.editor` 版面是 `flex-direction: column` 單欄結構，切換模式只需 `hidden` attribute，無需更動版面。
- 切換語意清晰：進入 preview 就是「看最終結果」，和 Obsidian 閱讀模式一致。

---

### `marked.use({ gfm: true, breaks: true })` 選項依據

```js
marked.use({ gfm: true, breaks: true });
```

- **`gfm: true`**（GitHub Flavored Markdown）：啟用表格、刪除線、圍欄式程式碼區塊（` ``` `）等擴充語法。
- **`breaks: true`**：單個換行（`\n`）直接轉為 `<br>`，符合直覺——在 textarea 按 Enter 就換行。若不開，需兩個連續換行才產生新段落。

---

### `preprocessMarkdown()` 的作用

marked.js 只解析標準 `![alt](url)` 語法；Obsidian 的 `![[filename]]` 是非標準格式，需先轉換：

```js
function preprocessMarkdown(text) {
  return text.replace(
    /!\[\[([^\]]+)\]\]/g,
    (_, filename) => `![${filename}](/static/uploads/${oauthUserId}/${filename})`
  );
}
```

轉換後再傳入 `marked.parse()`。`oauthUserId` 在 app.js 全域可用（登入狀態），無需額外傳參。

---

### XSS 安全性說明

`marked.parse()` 輸出 HTML，透過 `notePreview.innerHTML` 注入 DOM。
對個人筆記應用這是可接受的：每位使用者只看得到自己的 content，不存在跨用戶 XSS 風險。
若未來允許筆記分享，需加入 DOMPurify 過濾再設定 `innerHTML`。

---

## Image Upload

本章節說明圖片上傳功能的實作方式與設計依據（`src/routes/images.py`、`src/static/app.js`）。

### 儲存策略：本地 `src/static/uploads/{user_id}/`

| 策略 | 優點 | 缺點 |
|------|------|------|
| 本地 `src/static/uploads/` | 零外部依賴；FastAPI StaticFiles 直接提供 | 無 volume 時容器重建後遺失 |
| 雲端物件儲存（S3 等） | 高可用、不受容器影響 | 需 AWS SDK、環境變數、費用 |
| DB BLOB | 無額外儲存服務 | 大幅增加 DB 壓力，不適合圖片 |

選擇本地儲存。`app.mount("/static", StaticFiles(...))` 已能提供 `/static/uploads/` 下的任意檔案，零額外設定。開發環境以 `- .:/app` Docker volume 掛載持久化；`src/static/uploads/` 加入 `.gitignore` 避免意外提交用戶上傳內容。

---

### 檔案命名：`uuid4().hex + 副檔名`

```python
suffix = Path(file.filename or "").suffix.lower() or ".bin"
filename = f"{uuid.uuid4().hex}{suffix}"
```

- `uuid4().hex`：128-bit 隨機，碰撞機率極低；省略 `-` 讓檔名更簡短。
- **不保留原始檔名**：避免路徑穿越攻擊（如 `../../etc/passwd`）與中文、空白字元問題。
- **副檔名保留**：讓瀏覽器依副檔名推斷 Content-Type（StaticFiles 採用此機制）。

---

### MIME type 白名單驗證（而非副檔名黑名單）

```python
ALLOWED_CONTENT_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"
}
if file.content_type not in ALLOWED_CONTENT_TYPES:
    raise HTTPException(status_code=400, detail="Only image files are allowed")
```

副檔名可由使用者任意偽造（`evil.exe` 改名 `evil.png`），而 `content_type` 由 HTTP multipart header 提供，更難篡改。白名單比黑名單嚴格：支援新格式時明確加入 set 即可。

> ⚠️ `content_type` 仍為 client 端提供，非完全可信。生產環境應加入 `python-magic` 做 magic-byte 驗證。

---

### 5 MB 上限

```python
MAX_BYTES = 5 * 1024 * 1024
data = await file.read()
if len(data) > MAX_BYTES:
    raise HTTPException(status_code=413, detail="File too large (max 5 MB)")
```

先 `read()` 全部內容再檢查大小（非 streaming）——對 5 MB 以內的個人筆記圖片記憶體負擔可接受，實作最簡單。
5 MB 足夠一般螢幕截圖或相機縮圖；大型 RAW 原始檔案不在此應用的使用情境。

---

### `get_current_user_id` 重用

```python
from .notes import get_current_user_id

user_id: int = Depends(get_current_user_id),
```

Auth 邏輯（Bearer Token 解析、`?user_id` fallback、401 處理）完全重用 `routes/notes.py` 的現有依賴，不重複實作。圖片存入 `uploads/{user_id}/` 子目錄實現用戶隔離。

---

### Obsidian `![[filename]]` vs 標準 `![alt](url)`

| 語法 | 優點 | 缺點 |
|------|------|------|
| 標準 `![alt](url)` | 任何 Markdown 工具通用 | 需在筆記中存絕對路徑；路徑變更需更新所有筆記 |
| Obsidian `![[filename]]` | 只存 UUID 檔名；路徑由前端 render 時動態組合 | 非標準，需 `preprocessMarkdown()` 轉換 |

選擇 `![[filename]]`。筆記 content 只存 UUID 檔名，與伺服器位址解耦——未來若儲存路徑改變，只需改 `preprocessMarkdown()`，不需更新所有筆記的內容。

---

### 上傳後自動切回編輯模式

```js
if (isPreviewMode) togglePreview();
insertAtCursor(contentInput, `![[${filename}]]`);
```

`insertAtCursor()` 需要操作 `textarea.selectionStart / selectionEnd`，但 hidden 元素無游標狀態。
先切回 edit 模式讓 textarea 可見，再插入語法，確保游標位置正確。

---

### Insert Image 按鈕可見性：與 `setMetaVisible()` 連動

```js
function setMetaVisible(visible) {
  noteMeta.hidden = !visible;
  imageUploadLabel.hidden = !visible;   // Insert Image 同步顯示/隱藏
}
```

未載入任何筆記時，`user_id` 情境尚不確定（新筆記尚未儲存、剛開啟頁面）。
將 Insert Image 與 note-meta bar 一起隱藏，確保使用者只在有效筆記存在時才能上傳，避免產生孤立的、無法在任何筆記中引用的圖片。

---

## MCP Integration

本章節說明透過 MCP（Model Context Protocol）Server 將 Claude Desktop 與筆記系統串接的設計依據。

> **架構說明（2026-05）**：MCP Server 已從本後端專案**移出**，建立為獨立目錄 `~/claude/mcp/`。
> 筆記直接寫成本地 `.md` 檔案存入 Obsidian vault（`/mnt/c/Data/obsidian/joseph/`），**不再依賴 Docker 後端**。
> 原先的 HTTP 呼叫架構已廢棄。詳見 `docs/MCP_SETUP.md`。

### 為何選用 MCP 而非 Anthropic API call

| 方案 | 費用 | 說明 |
|------|------|------|
| Anthropic API（付費） | 按 token 計費 | 每次 AI 互動都有成本 |
| Claude Desktop + MCP | 訂閱制，無額外費用 | Claude Desktop 已包含使用量，MCP 工具呼叫不另計費 |

選擇 Claude Desktop + MCP。理由：個人筆記場景下 AI 互動頻率高，API 計費會累積；Claude Desktop 訂閱已含使用量，透過 MCP 讓 Claude Desktop 呼叫本機是零邊際成本的方案。

---

### 為何 MCP Server 移出後端專案、不依賴 Docker

MCP Server 的工具（論文筆記、每日 review）本質上是個人 `.md` 檔的讀寫，與後端的多用戶 DB 沒有關係。每次使用 MCP 都要先 `docker compose up` 是不必要的耦合。

新架構：

```
Claude Desktop (本機)
    │ stdio subprocess
    ▼
~/claude/mcp/mcp_notes_server.py
    │ 直接寫 .md 檔
    ▼
/mnt/c/Data/obsidian/joseph/papers/        ← 論文筆記
/mnt/c/Data/obsidian/joseph/daily-reviews/ ← 每日 review
```

MCP Server 完全獨立，不需 Docker，筆記在 Obsidian APP 中直接可見。

---

### 工具職責劃分

| 工具 | 職責 |
|------|------|
| `create_paper_note` | 寫入：新增一則論文筆記為 `.md` 檔至 Obsidian papers/ |
| `list_today_notes` | 查詢：列出今日 papers/ 及 daily-reviews/ 中的檔案 |
| `send_slack_digest` | 推送：讀今日論文 `.md`，格式化後傳送到 Slack |
| `create_daily_review` | 寫入：儲存當天 Claude 使用回顧至 Obsidian daily-reviews/ |
| `get_paper_preferences` | 讀取：從 `paper_preferences.md` 取得搜尋偏好 |
| `create_session_note` | 寫入：儲存任一平台的 session 摘要至 Obsidian sessions/ |
| `get_today_session_notes` | 讀取：取得今日所有跨平台 session notes 供 daily review 使用 |

工具職責單一，Claude Desktop 可自由組合。例如使用者說「先幫我整理這篇論文再傳到 Slack」，Claude 會依序呼叫 `create_paper_note` 再呼叫 `send_slack_digest`。

---

### `create_daily_review` 工具：每日 Claude 使用回顧

#### 為何自動帶日期而非讓使用者指定標題

`create_daily_review` 的標題固定為 `Daily Review — YYYY-MM-DD`，由工具內部用 `date.today()` 生成，使用者不需要傳入 `title` 參數。

理由：每日 review 的主鍵是日期，不是自由文字標題；固定格式讓筆記列表中的 review 可一眼辨識，也避免同一天產生格式不一的重複 review。

#### 與 `create_paper_note` 的差異

| 工具 | 適用情境 | 標題來源 |
|------|---------|---------|
| `create_paper_note` | 記錄一篇論文的閱讀心得 | 使用者提供（論文原名） |
| `create_daily_review` | 記錄當天 Claude 使用的高層次摘要 | 自動生成（`Daily Review — YYYY-MM-DD`） |

Docstring 中的格式範例讓 Claude 知道 `summary` 應包含哪些章節（今日摘要、主要決策、學到的事、明日跟進），即使使用者只說「幫我記錄今天」，Claude 也能自動套用格式。

---

### `get_paper_preferences` 工具與 `paper_preferences.md`

#### 為何用獨立 Markdown 檔案而非直接寫死在 prompt 裡

| 方案 | 優點 | 缺點 |
|------|------|------|
| 直接在 Cowork prompt 寫偏好 | 無需額外工具 | 每次改偏好需重新編輯 Cowork prompt；不易版本管理 |
| 獨立 `paper_preferences.md` | 一個地方管理；可 git 追蹤；人類可讀 | 需要 `get_paper_preferences` 工具讀取 |

選擇獨立 Markdown 檔案。Claude Desktop 的 Cowork prompt 是一次性設定，改動不方便；`paper_preferences.md` 是普通文字檔，用任何編輯器即可修改，且與程式碼一起受 git 管理，可追蹤偏好的演變歷程。

#### 為何用 Markdown 格式而非 JSON/YAML

Markdown 的 `##` 章節和 `-` 列表對人類最直覺，且不需要嚴格的格式語法（少了逗號不會 parse error）。`get_paper_preferences` 直接把整個檔案當字串回傳給 Claude，Claude 理解自然語言結構遠比解析 JSON key 更可靠。

#### 路徑解析：`Path(__file__).parent / "paper_preferences.md"`

```python
prefs_path = Path(__file__).parent / "paper_preferences.md"
```

MCP Server 被 Claude Desktop 啟動時，working directory 可能是任意路徑（通常是 Claude Desktop 的安裝目錄）。用 `__file__` 取得腳本自身位置，再以 `.parent` 往上一層，確保無論在哪裡啟動都能找到正確路徑。

---

### `.env` 的 `override=True`：WSL + Windows 環境變數問題

```python
load_dotenv(Path(__file__).parent / ".env", override=True)
```

Claude Desktop on Windows 在 `claude_desktop_config.json` 的 `env` 區塊設定環境變數，然後啟動 `wsl python3 ...`。WSL 啟動的 subprocess 繼承 Windows 傳入的環境變數。若 `SLACK_WEBHOOK_URL: ""` 出現在 config 的 env 中，`os.environ` 裡就已有該 key（值為空字串）。

預設的 `load_dotenv()` **不覆蓋**已存在的環境變數，導致 `.env` 中的真實 URL 被空字串遮蓋。加上 `override=True` 後，`.env` 的值永遠取得優先權，`.env` 成為唯一真實來源，config 中的 env 區塊只作為文件說明用途。

---

## Slack Digest

本章節說明 Slack 每日摘要傳送功能的設計依據（`mcp_notes_server.py` 中的 `send_slack_digest`）。

### 為何用 Incoming Webhook 而非 Slack Bot

| 方案 | 設定複雜度 | 說明 |
|------|-----------|------|
| Incoming Webhook | 低 | 只需一個 URL，不需 Bot Token、OAuth 流程 |
| Slack Bot（Bolt SDK） | 中 | 需建立 Bot、管理 Token、處理事件訂閱 |

選擇 Incoming Webhook。理由：本功能只需「傳送訊息」，不需「接收訊息」或「回應互動」；Webhook 是最輕量的單向推送方案，無需額外 SDK。

---

### 為何不做 PDF 轉換（Slack 版本）

Slack 原生支援 **mrkdwn** 格式，可在訊息中直接呈現粗體、程式碼區塊、列表等 Markdown 元素，無需轉換為 PDF。PDF 只在 LINE 等不支援富文字的管道才有必要（LINE 版本為未來擴充項目）。

---

### 為何不做自動排程

| 方案 | 適用條件 |
|------|---------|
| APScheduler / cron | 系統 24/7 常駐 |
| 手動觸發（MCP 工具） | 系統按需啟動 |

本系統以 `docker compose up` 按需啟動，固定時間 cron 在容器未啟動時會靜默失敗。改為 MCP 工具手動觸發：使用者說「傳今日摘要到 Slack」即立即執行，UX 更直覺，且不依賴系統常駐。

---

### Slack Webhook 放在 MCP Server 而非後端

Slack Webhook URL 是「使用者個人工作流程設定」，屬於客戶端配置，不應進入後端的業務邏輯。若放在後端，每個使用者要用不同 Webhook URL 就需要 DB 欄位、API 端點等額外設計。

放在 MCP Server 的環境變數中，設定隔離、修改不需重建 Docker image，也讓後端保持 content-agnostic。

---

### Slack Block Kit 訊息結構

```
[header block]  📚 Daily Paper Digest — YYYY-MM-DD
[divider]
[section block] *1. 論文標題*
                內容前 500 字預覽...
[divider]
[section block] *2. 論文標題*
                ...
[divider]
```

使用 Block Kit 而非純文字的原因：Block Kit 支援 header 元素（大字標題）、分隔線，視覺層次更清晰；且 Slack 的 mrkdwn 在 section block 中完整支援，筆記中的 `**bold**`、`` `code` ``、`- list` 均能正確渲染。

---

## Cross-Platform Session Notes

本章節說明跨平台 session note 功能的設計依據（`~/claude/mcp/mcp_notes_server.py`）。

### 為何需要跨平台 session note

Claude Desktop 的 `create_daily_review` 只能看到**當前對話 context**，無法感知 Claude Code、Claude Web 等其他 session 發生的事。使用者每天可能在多個平台工作：Claude Code 做工程任務、Claude Web 討論設計、Desktop 查論文——這些 context 完全隔離，無法自動合併。

解法：在各平台 session 結束時，呼叫 `create_session_note` 存一則高層次摘要到 Obsidian。Desktop 做 daily review 前呼叫 `get_today_session_notes` 讀入這些紀錄，再一起整理。

---

### `create_session_note` 的 append 行為

同一天、同一 source 重複呼叫時，內容**追加**（append）而非覆寫，以 `---` 分隔。

理由：Claude Code session 可能在一天內分多次短暫開啟（早上做 A、下午做 B），每次結束都存一次。若覆寫，只保留最後一次的摘要，早上的工作消失。Append 讓所有 session 累積在同一個日期檔案中，review 時可看到完整的一天。

---

### `source` 參數用 `str` 而非 Enum

`source` 設計為自由字串（如 `"claude-code"`、`"claude-web"`、`"claude-desktop"`），而非固定 Enum。

理由：未來可能有新平台（如 Claude Mobile、IDE plugin）；Enum 每次新增值都需要改程式碼並重啟 Claude Desktop。自由字串讓使用者自定義來源標識，不需動程式碼。

---

### 為何存 `sessions/` 而非 `daily-reviews/`

`daily-reviews/` 是最終整理好的當日回顧（高品質、一份），`sessions/` 是各平台的原始摘要（多份、可能格式不一致）。語意分開後：
- Obsidian 中可分開瀏覽
- 後端網頁同步時可分別處理（session notes 也能單獨查看）
- 不會讓 daily review 被中間草稿污染

---

### `get_today_session_notes` 與 `create_daily_review` 的協作

```
使用者說「記錄今天的 daily review」
    ↓
Claude 呼叫 get_today_session_notes()
    ↓ 回傳今日各平台 session 摘要
Claude 結合當前對話 + session notes，整理出完整 summary
    ↓
Claude 呼叫 create_daily_review(summary=...)
    ↓
Obsidian daily-reviews/daily-review-YYYY-MM-DD.md
```

Claude 負責「理解與合併」，工具只負責「讀」和「寫」，符合 MCP 工具單一職責原則。

---

## Obsidian → Backend Sync

本章節說明 `docker compose up` 時自動同步 Obsidian 筆記到後端 DB 的設計依據（`src/main.py`）。

### 問題

MCP 筆記存在 Obsidian vault（Windows 本地 `.md` 檔），後端 PostgreSQL 完全不知道這些檔案的存在。使用者想在後端網頁系統（`http://localhost:8000`）也能瀏覽論文筆記和 daily review。

### 方案選擇：啟動時 import

| 方案 | 優點 | 缺點 |
|------|------|------|
| 啟動時 import（本方案） | 零額外服務；每次 `compose up` 自動執行 | 只在啟動時同步，中途新增的筆記要重啟才看到 |
| 雙向即時同步（inotify/watchdog） | 即時 | 需要常駐 watchdog process；複雜度高 |
| 獨立同步 API（`POST /obsidian/sync`） | 可手動觸發 | 使用者需記得呼叫 |

選啟動時 import。理由：後端是按需啟動的（`docker compose up`），啟動時同步是最自然的時機。使用者結束一天工作後隔天啟動後端，就能看到昨天的所有 MCP 筆記。

### 去重策略：title-based

去重以「同 user_id + 同 title」判斷是否已存在，已存在則 skip，不覆寫。

選 title 而非新增 `source_file` 欄位的理由：
- 不需要 DB schema 變更（現有專案無 Alembic，`create_all` 不會 ALTER 既有表）
- papers/daily-reviews/sessions 的標題都是結構化唯一字串（`Daily Review — YYYY-MM-DD`、論文原名），碰撞機率極低
- 保持最小異動原則

### Docker volume mount 用 read-only

```yaml
- /mnt/c/Data/obsidian/joseph:/app/obsidian:ro
```

`ro`（read-only）確保容器內的程式碼無法意外修改 Obsidian 檔案。import 邏輯是單向的（Obsidian → DB），不需要寫入權限。

### user_id=1 Bootstrap

Obsidian 筆記屬於 `google:user:1`（個人使用）。啟動時若 user_id=1 不存在（全新 DB），同步函式直接建立：

```python
User(user_id=1, user_name="Google User 1", user_email="google-1@oauth.local")
```

這與 `src/routes/notes.py:30` 的 `ensure_oauth_user(db, provider="google", user_id=1)` 邏輯完全一致：相同的 `user_name` 格式和 `user_email` 格式，確保後續 OAuth 登入不會產生衝突（`ensure_oauth_user` 在 user 已存在時直接 return）。

---

## Preview 預設開啟 + 切換筆記 Bug 修正

本章節說明將 Preview 設為預設狀態，以及修正切換筆記時 preview 卡住的設計依據（`src/static/app.js`）。

### Bug 根本原因

`loadNote()` 呼叫後更新了 `contentInput.value`，但沒有處理 `isPreviewMode = true` 時的 preview 重新渲染。

使用者操作流程：

```
點擊筆記 A → loadNote(A) → contentInput.value = A.content
↓ 點擊 Preview → isPreviewMode = true，notePreview.innerHTML = A 的 HTML
↓ 點擊筆記 B → loadNote(B) → contentInput.value = B.content
               ↑ 但 notePreview 仍顯示 A 的 HTML！（bug）
```

`clearEditor()`（新建筆記）有做 `if (isPreviewMode) togglePreview()`，
所以新建不會卡，但切換既有筆記會卡。

### 修正方式：在 `loadNote()` 統一管理 preview 狀態

```javascript
// 在 contentInput.value = note.content 之後
if (!isPreviewMode) {
  togglePreview();         // edit → preview（實現預設 preview）
} else {
  notePreview.innerHTML = marked.parse(preprocessMarkdown(contentInput.value || ""));
  // preview → 用新筆記內容重新渲染（修 bug）
}
```

兩個分支涵蓋所有情況，無論當前狀態為何，切換完成後都保持 preview 狀態並顯示正確內容。

### 為何 Preview 設為預設

| 狀態 | 適合情境 |
|------|---------|
| Edit（舊預設） | 開啟筆記後立即編輯 |
| Preview（新預設） | 開啟筆記後先閱讀，需要修改才切 edit |

個人筆記的主要操作是**閱讀**（回顧、查找），而非每次點開都要編輯。
Preview 預設讓 Markdown 格式（標題、程式碼、表格）立即可讀，
Edit 作為手動切換的動作，明確表達「我現在要修改這則筆記」的意圖。

### `clearEditor` 不需改動的原因

新建筆記時 `clearEditor()` 的 `if (isPreviewMode) togglePreview()` 自動切回 edit mode，
讓使用者可以直接輸入標題和內容，行為符合直覺（新建 = 編輯狀態）。
