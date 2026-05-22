# Slack Incoming Webhook 設定教學

本教學說明如何建立 Slack Incoming Webhook，讓 `send_slack_digest` 工具可以將每日 paper 摘要傳送到指定的 Slack 頻道。

---

## 前置條件

- 一個 Slack 工作區（workspace），你有權限建立 App
- 已完成 `docs/MCP_SETUP.md` 的設定

---

## Step 1：建立 Slack App

1. 前往 [https://api.slack.com/apps](https://api.slack.com/apps)
2. 點擊右上角 **Create New App**
3. 選擇 **From Scratch**
4. 填入：
   - **App Name**：`Personal Notes Digest`（或任意名稱）
   - **Pick a workspace**：選擇你的工作區
5. 點擊 **Create App**

---

## Step 2：啟用 Incoming Webhooks

1. 在左側選單找到 **Incoming Webhooks**
2. 將右上角的開關切換為 **On**
3. 頁面往下滾，點擊 **Add New Webhook to Workspace**
4. 選擇要接收訊息的頻道（例如 `#paper-digest`）
5. 點擊 **Allow**

---

## Step 3：複製 Webhook URL

授權後回到 **Incoming Webhooks** 頁面，你會看到一個以 `https://hooks.slack.com/services/` 開頭的 URL。

複製這個 URL。

---

## Step 4：設定到 MCP Server

編輯 `~/claude/mcp/.env`，將 Webhook URL 填入：

```
SLACK_WEBHOOK_URL=貼上你的 Webhook URL
```

儲存後**重啟 Claude Desktop**。

儲存後**重啟 Claude Desktop**。

---

## Step 5：測試

先確認後端正在運行，然後在 Claude Desktop 輸入：

```
把今天的 paper 筆記傳到 Slack
```

Claude Desktop 會呼叫 `send_slack_digest` 工具，若設定正確，你的 Slack 頻道應會收到類似以下的訊息：

```
📚 Daily Paper Digest — 2026-05-22
─────────────────────────────────
1. Attention Is All You Need
   Transformer 架構完全基於 Self-Attention
   機制，不使用任何 RNN 或 CNN...
─────────────────────────────────
2. BERT: Pre-training of Deep Bidirectional...
```

---

## Slack 訊息格式說明

`send_slack_digest` 使用 **Slack Block Kit** 格式：

| 元素 | 說明 |
|------|------|
| Header block | 顯示日期標題 `📚 Daily Paper Digest — YYYY-MM-DD` |
| Section block | 每篇筆記的標題（粗體）+ 前 500 字內容預覽 |
| Divider block | 各筆記之間的分隔線 |

Markdown 語法（`**bold**`、`` `code` ``、`- list`）在 Slack 的 mrkdwn 格式中會自動轉換顯示，無需額外處理。

---

## 常見問題

### `Error: SLACK_WEBHOOK_URL is not set`

`claude_desktop_config.json` 中的 `SLACK_WEBHOOK_URL` 是空字串或未填入。確認已填入完整 URL 並重啟 Claude Desktop。

### Slack 回傳 `channel_not_found` 或 `invalid_payload`

Webhook URL 可能已失效或被撤銷。回到 [https://api.slack.com/apps](https://api.slack.com/apps)，在對應 App 的 Incoming Webhooks 頁面重新生成 URL。

### 沒有筆記可傳送

`send_slack_digest` 預設只傳今日筆記（依 `note_date` 過濾）。若今天尚未建立任何筆記，工具會回傳「No notes to send for today」。可先用 `create_paper_note` 新增一則測試。

### 傳送特定筆記（而非今日全部）

```
把筆記 ID 3 和 5 傳到 Slack
```

Claude Desktop 會以 `note_ids="3,5"` 呼叫工具，只傳送指定的筆記。
