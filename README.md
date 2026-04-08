# 📄 Invoice Processor

An AI-powered invoice processing tool that extracts structured data from images and PDFs using **Google Gemini 3 Flash** and saves the results to **Notion** databases.

![Tech Stack](https://img.shields.io/badge/Runtime-Bun-yellow) ![AI](https://img.shields.io/badge/AI-Gemini%203%20Flash-blue) ![Database](https://img.shields.io/badge/Database-Notion-black)

## ✨ Features

- **Multi-Format Upload**: Process PNG, JPG, WEBP images and PDF documents
- **AI-Powered OCR**: Gemini 3 Flash extracts structured invoice data with high accuracy
- **Multi API Key Rotation**: Add multiple Gemini API keys for automatic load balancing and failover
- **Notion Integration**: Auto-creates a database and saves each invoice as a page with line items
- **Drag & Drop UI**: Simple, clean interface for uploading files and managing API keys
- **Fast & Lightweight**: Powered by Bun runtime, vanilla HTML/JS/CSS frontend

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime installed on your system
- Google Gemini API keys (free from [Google AI Studio](https://aistudio.google.com/))
- Notion API key (from [Notion Integrations](https://www.notion.so/my-integrations))

### Installation

```bash
# Clone the repository
git clone https://github.com/zaktomate-org/invoice-processor.git
cd invoice-processor

# Install dependencies
bun install

# Copy environment file and configure
cp .env.example .env
# Edit .env with your Notion API key (see detailed setup below)
```

### Running the Server

```bash
# Development mode (with hot reload)
bun run dev

# Production mode
bun run start
```

The server starts at `http://localhost:3000` by default (configurable via `PORT` in `.env`).

---

## 🔑 Detailed API Key Setup Guide

### 1. Create a Notion Database

You need to create a table (database) in Notion yourself and share it with the integration:

1. **Open Notion** and create a new page or use an existing one
2. **Type `/table`** and select **"Table"** to create a new database
3. Give it a name like "Transaction Ledger" or "Invoices"
4. **Share the database with your integration:**
   - Click the **"•••" (three dots)** in the top-right of the database
   - Click **"Add connections"** (or "Connect to")
   - Search for and select your integration name

> 📍 **Where to place it**: The database stays exactly where you create it — workspace root, inside a page, wherever you want. No random placement.

### 2. Select the Database in the App

1. Start the server: `bun run dev`
2. Open `http://localhost:3000`
3. Scroll to the **📊 Transaction Database** section
4. You'll see a list of all databases shared with your integration
5. Click **"Select"** on the one you created
6. The app automatically adds the required columns (Date, Transaction Type, Amount, etc.) to your table
7. Your selection is saved to `.env` — future runs use the same database automatically

> ⚙️ **Schema auto-configuration**: When you select a database, the app checks if it has the required columns and adds any missing ones. If a column exists with the wrong type, a fallback column is created (e.g., "Date (Txn)").

### 3. Add Your Notion API Key to `.env`

1. Go to **[notion.so/my-integrations](https://www.notion.so/my-integrations)**
2. Click on your integration → **"Internal Integration"** tab
3. Copy the token (starts with `ntn_`)
4. Paste it in `.env`:

   ```env
   NOTION_API_KEY=ntn_your-token-here
   ```

> ⚠️ **DO NOT click "Refresh"** unless your token was exposed — this immediately invalidates your current token.

### Step 4: Google Gemini API Keys

1. Go to **[Google AI Studio](https://aistudio.google.com/)**
2. Sign in with your Google account
3. Click **"Create API Key"** in the left sidebar
4. Copy the generated key (starts with `AIza...`)
5. Add it to the Invoice Processor UI in the **⚙️ Gemini API Keys** section (at the bottom of the page)

> **Tip**: Create multiple API keys for automatic rotation and fallback. The system randomly selects a key per request and retries with other keys if one fails.

---

## 📋 Usage

1. **Open** `http://localhost:3000` in your browser
2. **Add Gemini API Keys** in the ⚙️ section at the bottom
3. **Upload invoices** by dragging & dropping files or clicking the upload zone
4. **Click "Process Invoices"** to start OCR processing
5. **View results** — extracted data appears in formatted cards showing:
   - Transaction type (Income ▲ or Expense ▼)
   - Signed amount (+ for income, – for expense)
   - Invoice ID, date, parties, and summary
   - Full line items and totals
6. **Check Notion** — a "Transaction Ledger" database is auto-created under the first shared page
   - `NOTION_DATABASE_ID` is automatically saved to your `.env` file
   - Each invoice creates a **row** in the ledger table with: Date, Type, Amount, Invoice ID, Parties, Summary, and a clickable "see full" link
   - Clicking "see full" opens a **nested child page** with the complete invoice details (vendor info, line items, totals)

### Supported File Formats

| Format | Extensions | Max Size |
|--------|-----------|----------|
| Images | PNG, JPG, JPEG, WEBP | 50 MB |
| Documents | PDF | 50 MB |

> **Note**: PDFs are sent directly to Gemini as base64-encoded files. Gemini 3 Flash processes them natively with its vision pipeline.

---

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Browser   │────▶│  Bun Server  │────▶│  Gemini 3 Flash  │
│  (Upload)   │     │  (Port 3000) │     │  (OCR + JSON)    │
└─────────────┘     └──────┬───────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │    Notion    │
                    │  (Database)  │
                    └──────────────┘
```

### Request Flow

1. User uploads invoice files (images or PDFs) via drag & drop
2. Bun server receives files, validates types/sizes, encodes to base64
3. Random Gemini API key selected from pool
4. File sent to `gemini-3-flash-preview` with structured JSON schema
5. Gemini returns extracted data: transaction type (income/expense), signed amount, invoice ID, parties, summary + full invoice details
6. **Notion Step 1**: A row is created in the "Transaction Ledger" database with ledger fields
7. **Notion Step 2**: A child page is created under the database row with full invoice details (vendor, line items, totals)
8. **Notion Step 3**: The "See Full" column is updated with a clickable link to the child page
9. Results displayed in browser with formatted cards

### Database Auto-Creation

- On first run (when `NOTION_DATABASE_ID` is empty in `.env`), a "Transaction Ledger" database is automatically created under the first page shared with your integration
- The database ID is **persisted back to your `.env` file** for future runs
- Subsequent runs reuse the same database — no duplicate databases are created
- To use a different database, manually set `NOTION_DATABASE_ID` in `.env`

---

## 📁 Project Structure

```
invoice-processor/
├── src/
│   ├── server.ts              # Bun HTTP server with routing
│   ├── api/
│   │   ├── keys.ts            # Multi API key pool management
│   │   └── upload.ts          # File upload handler
│   ├── services/
│   │   ├── gemini.ts          # Gemini 3 Flash OCR integration
│   │   └── notion.ts          # Notion database & page creation
│   ├── types.ts               # TypeScript interfaces
│   └── utils.ts               # File encoding helpers
├── public/
│   ├── index.html             # Frontend UI
│   ├── app.js                 # Client-side logic
│   └── styles.css             # Styling
├── .env                       # Environment variables (gitignored)
├── .env.example               # Template for environment variables
├── package.json               # Dependencies and scripts
└── plan.md                    # Development plan with checkpoints
```

---

## 🔧 Configuration

| Variable | Description | Default |
|----------|------------|---------|
| `NOTION_API_KEY` | Notion integration token (starts with `ntn_` or `secret_`) | _(required)_ |
| `NOTION_DATABASE_ID` | Database ID — auto-filled on first run if left empty | _(auto-created)_ |
| `PORT` | Server port number | `3000` |

### Notion Database Structure

The auto-created "Transaction Ledger" database has these columns:

| Column | Type | Example |
|--------|------|---------|
| **Title** | Title | `INV-2024-001` |
| **Date** | Date | `2024-03-15` |
| **Transaction Type** | Select | `Expense` (red) / `Income` (green) |
| **Amount** | Number | `-249.99` (expense) or `+500.00` (income) |
| **Invoice ID** | Rich Text | `INV-2024-001` or empty |
| **Parties** | Rich Text | `Staples Inc. → Shoyeb` |
| **Summary** | Rich Text | `Office supplies purchase from Staples` |
| **See Full** | Rich Text (link) | Clickable "see full" → opens child page with full invoice |

---

## 🔄 API Key Rotation

The system supports multiple Gemini API keys for:

- **Load Balancing**: Random key selection distributes requests across keys
- **Failover**: If one key fails (rate limit, error), automatically retries with next key
- **Usage Tracking**: View request count and last used timestamp per key

### Managing Keys via UI

1. Scroll to **⚙️ Gemini API Keys** section
2. Paste a key and click **"Add Key"**
3. View all keys in the table with usage statistics
4. Delete keys with the **Delete** button

---

## 🐛 Troubleshooting

### "API token is invalid" (Notion 401 Unauthorized)

This is the **most common error**. Here's exactly how to fix it:

1. **Check your token in `.env`**:

   ```env
   NOTION_API_KEY=ntn_your-token-here
   ```

   - Make sure there are **no trailing spaces** or invisible characters
   - The token should start with `ntn_` (new format) or `secret_` (old format)

2. **Verify the token is still valid**:
   - Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
   - Click on your integration
   - Go to **"Internal Integration"** tab
   - If you see a **"Refresh"** button, your token is still valid (don't click refresh unless you need to!)
   - If the token looks different from what's in your `.env`, copy the new one

3. **⚠️ DO NOT click "Refresh"** unless your token is compromised — this **immediately invalidates** your current token

4. **Restart the server** after updating `.env`:

   ```bash
   # Stop current server (Ctrl+C), then:
   bun run dev
   ```

5. **Test the token manually** (optional):

   ```bash
   curl -H "Authorization: Bearer ntn_your-token-here" \
        -H "Notion-Version: 2026-03-11" \
        https://api.notion.com/v1/users/me
   ```

   If you get a JSON response with your bot info, the token is valid.

### "No database selected" / "No database configured"

This means no database has been selected yet:

1. Create a table in Notion (type `/table` on any page)
2. Share it with your integration: **`•••` → Add connections → select your integration**
3. Go to `http://localhost:3000` → **📊 Transaction Database** section
4. Click **"Select"** on your database
5. The app auto-adds all required columns

### "No shared databases found" in the database picker

This means no databases are shared with your integration:

1. Create a table in Notion (type `/table` on any page)
2. Click **`•••`** on the table → **"Add connections"** → select your integration
3. Refresh the app page or wait a few seconds — the database should appear

### "No Gemini API keys configured"

- Add at least one API key in the ⚙️ section of the UI
- Keys are stored in memory and lost on server restart — re-add after restart

### Gemini API rate limit errors

- Add more API keys to distribute the load
- The system automatically retries with different keys on failure

### TypeScript compilation errors

```bash
# Verify TypeScript compiles
bun run type-check

# Reinstall dependencies
bun install
```

---

## 📝 Development Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start server with hot reload |
| `bun run start` | Start server in production mode |
| `bun run type-check` | Run TypeScript type checking |

---

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh/) — Fast JavaScript/TypeScript runtime
- **AI Model**: [Gemini 3 Flash Preview](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash) — Multimodal OCR with structured output
- **Database**: [Notion API](https://developers.notion.com/) — Workspace database for invoice storage
- **Frontend**: Vanilla HTML/CSS/JS — Simple, no build step required

## 📄 License

MIT
