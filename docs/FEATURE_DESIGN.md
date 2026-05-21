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
