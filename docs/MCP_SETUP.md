# MCP Server 設定教學

本教學說明如何將 `~/claude/mcp/mcp_notes_server.py` 接上 Claude Desktop，以及如何理解 MCP 協議原理和未來新增工具的方法。

> 本文以 **WSL2（Ubuntu）+ Windows Store 版 Claude Desktop** 為主要環境撰寫。
> 與一般 Windows 安裝或 macOS 不同之處均以 `📦 Windows Store 差異` 標記。

---

## MCP 是什麼？它如何運作？

**MCP（Model Context Protocol）** 是 Anthropic 推出的開放協議，讓 AI 模型可以安全地呼叫外部工具。

### 通訊架構（本環境）

```
Claude Desktop（Windows Store，跑在 Windows）
    │
    │  wsl python3 ...（以 WSL subprocess 啟動）
    ▼
~/claude/mcp/mcp_notes_server.py（WSL 內的 Python process）
    │  stdin ← JSON-RPC 請求（Claude Desktop 寫入）
    │  stdout → JSON-RPC 回應（MCP Server 寫出）
    │
    │  直接寫 .md 檔案
    ▼
/mnt/c/Data/obsidian/joseph/
    ├── papers/              ← 論文筆記
    └── daily-reviews/       ← 每日 review
```

**無需 Docker**：MCP Server 直接讀寫本地 Markdown 檔案，筆記存入 Obsidian vault，用 Obsidian APP 可直接開啟。

### 通訊協定：JSON-RPC 2.0 over stdio

MCP 使用 **stdio transport**：Claude Desktop 以 subprocess 啟動 MCP Server，雙方透過 **標準輸入/輸出（stdin/stdout）** 交換 JSON 訊息。每條訊息都是一個 JSON-RPC 2.0 物件。

啟動時的握手流程：

```
Claude Desktop → MCP Server：{"method": "initialize", "params": {...}}
MCP Server → Claude Desktop：{"result": {"capabilities": {...}, "serverInfo": {...}}}
Claude Desktop → MCP Server：{"method": "tools/list"}
MCP Server → Claude Desktop：{"result": {"tools": [...]}}   ← Claude 知道有哪些工具
```

每次 Claude 決定呼叫工具時：

```
Claude Desktop → MCP Server：{"method": "tools/call", "params": {"name": "create_paper_note", "arguments": {"title": "...", "content": "..."}}}
MCP Server     → Claude Desktop：{"result": {"content": [{"type": "text", "text": "Saved: /mnt/c/Data/..."}]}}
```

### FastMCP 的角色

`FastMCP` 是 MCP Python SDK 的高階封裝，它自動處理：
- JSON-RPC 訊息的序列化 / 反序列化
- Type hint → JSON Schema 的轉換（Claude 用 Schema 決定如何填參數）
- Docstring → 工具描述的對應（Claude 用描述決定何時呼叫工具）
- 錯誤處理與 exception 回傳

你只需要寫 `@mcp.tool()` 裝飾的函式，其餘全由 FastMCP 處理。

---

## 初次設定步驟

### 前置條件

| 需求 | 說明 |
|------|------|
| Claude Desktop | Windows Store 版，已安裝並登入 |
| WSL2（Ubuntu） | Python 3.10+ 已安裝，uv 已安裝 |
| Obsidian | vault 位於 `C:\Data\obsidian\joseph`（WSL 路徑：`/mnt/c/Data/obsidian/joseph`） |

---

### Step 1：安裝 MCP 依賴

```bash
cd ~/claude/mcp
uv venv
uv pip install -r requirements.txt

# 驗證
.venv/bin/python -c "from mcp.server.fastmcp import FastMCP; print('OK')"
```

---

### Step 2：設定 `.env` 檔案

`~/claude/mcp/.env` 已建立，若需要修改：

```bash
code ~/claude/mcp/.env
```

內容：

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...（見 SLACK_SETUP.md）
OBSIDIAN_VAULT=/mnt/c/Data/obsidian/joseph
```

`OBSIDIAN_VAULT` 預設值已是正確路徑，無需修改。`.env` 不會提交到 git（在 `.gitignore` 中）。

---

### Step 3：找到設定檔

> 📦 **Windows Store 差異**
>
> Windows Store 版 Claude Desktop 的設定檔**不在**一般人預期的 `%APPDATA%\Claude\`，
> 而是在 Windows 的 Packages 沙盒目錄：
>
> ```
> C:\Users\user\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json
> ```
>
> 從 WSL 存取路徑：
> ```
> /mnt/c/Users/user/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude_desktop_config.json
> ```
>
> 若改了 `%APPDATA%\Claude\claude_desktop_config.json`（錯誤位置），Claude Desktop 完全不會讀到設定。

參考：其他平台的路徑
- macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows 一般安裝（非 Store）：`%APPDATA%\Claude\claude_desktop_config.json`

---

### Step 4：設定 MCP Server

> 📦 **Windows Store 差異**
>
> Windows Store 版 Claude Desktop 跑在 Windows 上，但腳本在 WSL 內。
> 因此 `command` 必須用 `"wsl"` 讓 Windows 啟動 WSL subprocess，
> `args` 傳入的是 **Linux 絕對路徑**（WSL 內部路徑，不是 Windows 路徑）。

編輯 `claude_desktop_config.json`（Step 3 的路徑），加入 `mcpServers` 區塊：

```json
{
  "mcpServers": {
    "personal-notes": {
      "command": "wsl",
      "args": [
        "/home/user/claude/mcp/.venv/bin/python",
        "/home/user/claude/mcp/mcp_notes_server.py"
      ]
    }
  }
}
```

注意：
- `args[0]` 是 `~/claude/mcp/.venv` 的 Python 路徑
- `args[1]` 是腳本的 WSL 絕對路徑
- **不需要** `env` 區塊——`.env` 檔案已由 `load_dotenv(override=True)` 處理

---

### Step 5：重啟 Claude Desktop

工具列右鍵 → 完全退出，再重新開啟（不是按 X 關視窗）。

---

### Step 6：確認工具已載入

在 Claude Desktop 對話框輸入：

```
列出今天的筆記
```

若工具正常載入，Claude 會呼叫 `list_today_notes` 並回傳結果。

若沒有反應，查看 MCP log（見常見問題）。

---

## 設定每日自動搜尋（Cowork 排程任務）

Claude Desktop 的 **Cowork** 功能支援排程任務。設定步驟：

1. 在 Claude Desktop 左側進入 **Cowork**
2. 建立新任務，設定執行時間（例如每天早上 9:00）
3. 將以下 prompt 貼入任務內容：

```
請依照以下步驟處理今日論文：
1. 呼叫 get_paper_preferences 讀取我的論文偏好設定
2. 根據偏好中的領域和關鍵字，搜尋今日 arXiv 上的最新論文
3. 從中挑選最相關的論文（不超過偏好設定的 max_papers 數量）
4. 為每篇論文呼叫 create_paper_note，以偏好設定的語言和格式整理筆記
5. 所有筆記建立完成後，呼叫 send_slack_digest 將今日摘要傳送到 Slack
```

**修改論文偏好：** 直接編輯 `~/claude/mcp/paper_preferences.md`，下次任務執行時會自動讀取最新設定，不需重啟任何服務。

---

## 跨平台 Session Note

在 Claude Code（或任何其他 Claude 平台）session 結束前輸入：

```
存一下今天的 session note
```

Claude 會整理當前對話的高層次決策摘要和完成功能，呼叫 `create_session_note(source="claude-code", content="...")`，寫入 `/mnt/c/Data/obsidian/joseph/sessions/YYYY-MM-DD_claude-code.md`。

同一天多次呼叫（多個短 session）會自動追加，不會覆寫。

**MCP 已同時接入 Claude Code**（`user` scope，所有專案有效）：
```bash
# 已執行，無需重複
claude mcp add --scope user personal-notes /home/user/claude/mcp/.venv/bin/python /home/user/claude/mcp/mcp_notes_server.py
```

---

## 每日 Claude 使用回顧

在 Claude Desktop 對話結束前輸入：

```
幫我記錄今天的 daily review
```

Claude 會先呼叫 `get_today_session_notes` 讀入今日所有跨平台紀錄（Claude Code、Web 等），再結合當前對話整理成完整摘要，呼叫 `create_daily_review`，儲存至 `/mnt/c/Data/obsidian/joseph/daily-reviews/daily-review-YYYY-MM-DD.md`。

若今天只使用了 Claude Desktop 沒有其他平台，Claude 會直接整理當前對話即可。

預設摘要格式（Claude 會自動套用）：

```markdown
## 今日摘要
- 做了什麼（一句話）

## 主要決策
- 決策或選擇了哪個方案

## 學到的事
- 技術概念、工具用法

## 明日跟進
- 尚未完成或需要繼續的事
```

---

## 如何新增 MCP 工具

### 基本結構

在 `~/claude/mcp/mcp_notes_server.py` 中加入一個 `@mcp.tool()` 裝飾的函式：

```python
@mcp.tool()
def my_new_tool(param1: str, param2: int = 0) -> str:
    """
    一句話說明這個工具的用途。
    Claude 會讀這段 docstring 來決定何時呼叫此工具。
    可以加更多說明：參數的意義、回傳格式、使用範例。
    """
    # 實作邏輯
    result = do_something(param1, param2)
    return f"結果：{result}"
```

### 規則

| 規則 | 說明 |
|------|------|
| `@mcp.tool()` 裝飾器 | 必須加，FastMCP 才會註冊為工具 |
| Type hints | 必填；轉換為 JSON Schema 供 Claude 填參數 |
| Docstring | 必填；這是 Claude 判斷「何時呼叫」的唯一依據 |
| 回傳值 | 必須是 `str`；Claude 讀取這個字串作為工具結果 |
| 異常處理 | 用 `try/except` 捕捉，回傳錯誤訊息字串（不要讓 exception 直接拋出） |

### 新增工具後的步驟

1. 儲存 `mcp_notes_server.py`
2. **重啟 Claude Desktop**（工具變更需重啟才生效）
3. 測試：在 Claude Desktop 說「呼叫 `my_new_tool`」

### 範例：新增「最近 N 篇論文」工具

```python
@mcp.tool()
def get_recent_papers(limit: int = 5) -> str:
    """
    Return the most recent N paper notes from the Obsidian vault (default 5).
    Useful when the user wants a quick overview of recently saved papers.
    """
    papers = sorted(PAPERS_DIR.glob("*.md"), reverse=True)[:limit]
    if not papers:
        return "No paper notes found."

    lines = [f"Recent {limit} paper notes:"]
    for p in papers:
        title = p.read_text(encoding="utf-8").splitlines()[0].lstrip("# ")
        lines.append(f"  • {p.name} — {title}")
    return "\n".join(lines)
```

### 工具設計原則

1. **Docstring 要讓 Claude 看得懂**：說明「什麼情況下使用」比說明「怎麼實作」更重要。
2. **永遠回傳字串**：錯誤訊息也用字串，不要 raise exception。
3. **參數型別要精確**：`str` vs `int` vs `Optional[str]` 直接影響 Claude 填參數的方式。
4. **單一職責**：每個工具做一件事；複合操作讓 Claude 依序呼叫多個工具。

---

## 目前工具列表

| 工具名稱 | 說明 | 主要參數 |
|----------|------|---------|
| `get_paper_preferences` | 讀取 `paper_preferences.md` 的偏好設定 | 無 |
| `create_paper_note` | 新增一則論文閱讀筆記為 `.md` 存至 Obsidian | `title`, `content` |
| `create_daily_review` | 儲存當日整合回顧（標題自動帶日期，可合併 session notes） | `summary`（Markdown） |
| `list_today_notes` | 列出今日所有筆記（papers/ + daily-reviews/） | 無 |
| `send_slack_digest` | 傳送今日論文摘要到 Slack | `filenames?`（逗號分隔） |
| `create_session_note` | 儲存任一 Claude 平台的 session 摘要至 Obsidian sessions/ | `source`, `content` |
| `get_today_session_notes` | 讀取今日所有跨平台 session notes | 無 |

---

## 常見問題

### 工具沒有出現

1. 確認 `claude_desktop_config.json` JSON 格式正確（用 [jsonlint.com](https://jsonlint.com) 驗證）
2. 確認 WSL 內的 Python 和腳本路徑存在：
   ```bash
   ls ~/claude/mcp/.venv/bin/python
   ls ~/claude/mcp/mcp_notes_server.py
   ```
3. 完整重啟 Claude Desktop（工具列右鍵退出，非按 X）

> 📦 **Windows Store 差異**：確認編輯的設定檔是 `LocalAppData\Packages\Claude_pzs8sxrjxfjjc\...` 下的那份，不是 `AppData\Roaming\Claude\`。兩個路徑都存在時很容易改錯。

### 筆記沒有出現在 Obsidian

確認 Obsidian vault 路徑正確：

```bash
ls /mnt/c/Data/obsidian/joseph/
```

若路徑不同，編輯 `~/claude/mcp/.env`：

```
OBSIDIAN_VAULT=/mnt/c/Data/obsidian/your-vault-name
```

然後重啟 Claude Desktop。

### 查看 MCP Server 錯誤 log

> 📦 **Windows Store 差異**：log 也在 Packages 沙盒目錄，不是 `AppData\Roaming\Claude\logs\`。

從 WSL 讀取：

```bash
cat "/mnt/c/Users/user/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/logs/mcp-server-personal-notes.log" | tail -30
```

log 中若看到 `Server started and connected successfully` 且 `tools/list` 有回傳工具，表示 MCP Server 正常；問題在別處。

### Slack 沒收到訊息

確認 `~/claude/mcp/.env` 中的 `SLACK_WEBHOOK_URL` 已設定（非空字串），且 Webhook 未過期（可在 [api.slack.com/apps](https://api.slack.com/apps) 重新生成）。
