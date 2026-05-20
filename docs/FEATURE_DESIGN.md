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
