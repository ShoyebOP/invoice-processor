import { handleUpload } from "./api/upload.ts";
import { addKey, listKeys, deleteKey } from "./api/keys.ts";
import {
  loadFailedSaves,
  removeFailedSave,
  clearAllFailedSaves,
  incrementRetryCount,
} from "./api/failedSaves.ts";
import { listSharedDatabases, selectDatabase, getDatabaseId, createInvoicePage } from "./services/notion.ts";
import { Client } from "@notionhq/client";

// Explicitly load .env file (Bun should do this automatically, but being explicit)
try {
  const envFile = Bun.file(".env");
  if (await envFile.exists()) {
    const envText = await envFile.text();
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=").trim();
        if (key && value) {
          Bun.env[key.trim()] = value;
          process.env[key.trim()] = value;
        }
      }
    }
  }
} catch {
  // .env file doesn't exist, skip
}

const PORT = parseInt(Bun.env.PORT || "3000", 10);

/**
 * Retry saving a single failed invoice to Notion
 */
async function retrySingleFailedSave(id: string): Promise<Response> {
  try {
    const failed = await loadFailedSaves();
    const entry = failed.find((f) => f.id === id);

    if (!entry) {
      return new Response(JSON.stringify({ error: "Failed save not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await incrementRetryCount(id);
    const notionPageId = await createInvoicePage(entry.invoiceData);
    const removed = await removeFailedSave(id);

    if (!removed) {
      console.warn(`Warning: Could not remove failed save ${id} after successful retry`);
    }

    console.log(`✅ Retried and saved to Notion: ${entry.invoiceData.invoiceNumber} (ID: ${id})`);

    return new Response(
      JSON.stringify({
        status: "success",
        id,
        notionPageId,
        invoiceNumber: entry.invoiceData.invoiceNumber,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Retry failed for ${id}:`, errorMessage);

    return new Response(
      JSON.stringify({
        status: "failed",
        id,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Retry saving all failed invoices to Notion
 */
async function retryAllFailedSaves(): Promise<Response> {
  try {
    const failed = await loadFailedSaves();

    if (failed.length === 0) {
      return new Response(JSON.stringify({ status: "no-failed-saves", total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const results: Array<{ id: string; status: string; invoiceNumber?: string; error?: string }> = [];

    for (const entry of failed) {
      try {
        await incrementRetryCount(entry.id);
        const notionPageId = await createInvoicePage(entry.invoiceData);
        await removeFailedSave(entry.id);
        results.push({
          id: entry.id,
          status: "success",
          invoiceNumber: entry.invoiceData.invoiceNumber,
        });
        console.log(`✅ Retried: ${entry.invoiceData.invoiceNumber}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        results.push({
          id: entry.id,
          status: "failed",
          error: errorMessage,
        });
        console.error(`❌ Retry failed for ${entry.fileName}: ${errorMessage}`);
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const failCount = results.filter((r) => r.status === "failed").length;

    return new Response(
      JSON.stringify({
        status: "completed",
        total: failed.length,
        successCount,
        failCount,
        results,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Retry all failed:", errorMessage);

    return new Response(
      JSON.stringify({ error: "Failed to retry", message: errorMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// Startup health check
async function healthCheck() {
  const apiKey = Bun.env.NOTION_API_KEY?.trim();

  if (!apiKey) {
    console.log("❌ Notion: NOTION_API_KEY not set in .env");
    console.log("   Get one at: https://www.notion.so/my-integrations");
    return;
  }

  try {
    const notion = new Client({ auth: apiKey });
    const response = await notion.users.me({});

    // Extract bot name if available
    const botName = (response as any).name || "Unknown";
    const workspaceName = (response as any).workspace_name || "Unknown";

    console.log(`✅ Notion: Connected as "${botName}" to "${workspaceName}"`);
  } catch (error: any) {
    const msg = error?.message || "Unknown error";

    if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid")) {
      console.log("❌ Notion: API token is invalid (401 Unauthorized)");
      console.log("");
      console.log("   HOW TO FIX:");
      console.log("   1. Go to https://www.notion.so/my-integrations");
      console.log("   2. Click your integration → 'Internal Integration' tab");
      console.log("   3. Copy the token (starts with 'ntn_')");
      console.log("   4. Paste in .env as NOTION_API_KEY");
      console.log("   5. ⚠️  DO NOT click 'Refresh' (invalidates current token)");
      console.log("   6. Restart the server");
      console.log("");
      console.log(`   Technical: ${msg}`);
    } else if (msg.includes("connection")) {
      console.log(`⚠️  Notion: Connection failed: ${msg}`);
    } else {
      console.log(`⚠️  Notion: Health check failed: ${msg}`);
    }
  }

  // Check database selection
  const dbId = await getDatabaseId();
  if (!dbId) {
    console.log("");
    console.log("⚠️  Notion: No database selected");
    console.log("   Go to http://localhost:3000 → Database section → pick a database");
    console.log("");
    console.log("   Steps:");
    console.log("   1. Create a table in Notion (or use existing)");
    console.log("   2. Share it with your integration (••• → Add connections)");
    console.log("   3. Select it in the app's database picker");
  } else {
    console.log(`✅ Notion: Database selected: ${dbId}`);
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // API Routes
      if (path === "/api/upload" && req.method === "POST") {
        return await handleUpload(req);
      }

      if (path === "/api/keys" && req.method === "POST") {
        return await addKey(req);
      }

      if (path === "/api/keys" && req.method === "GET") {
        return listKeys();
      }

      if (path.startsWith("/api/keys/") && req.method === "DELETE") {
        const keyId = path.replace("/api/keys/", "");
        return deleteKey(keyId);
      }

      // Database selection endpoints
      if (path === "/api/databases" && req.method === "GET") {
        const databases = await listSharedDatabases();
        const currentDbId = Bun.env.NOTION_DATABASE_ID?.trim() || null;
        return new Response(JSON.stringify({ databases, currentDatabaseId: currentDbId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (path === "/api/databases/select" && req.method === "POST") {
        try {
          const body = await req.json();
          const { id } = body as { id?: string };
          if (!id) {
            return new Response(JSON.stringify({ error: "Database ID required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const result = await selectDatabase(id);
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: "Failed to select database",
              message: error instanceof Error ? error.message : "Unknown error",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }

      // Failed saves endpoints
      if (path === "/api/failed-saves" && req.method === "GET") {
        const failed = await loadFailedSaves();
        return new Response(JSON.stringify({ failed, total: failed.length }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (path === "/api/failed-saves/retry-all" && req.method === "POST") {
        return await retryAllFailedSaves();
      }

      if (path.startsWith("/api/failed-saves/") && path.endsWith("/retry") && req.method === "POST") {
        const id = path.replace("/api/failed-saves/", "").replace("/retry", "");
        return await retrySingleFailedSave(id);
      }

      if (path === "/api/failed-saves/clear" && req.method === "POST") {
        await clearAllFailedSaves();
        return new Response(JSON.stringify({ status: "cleared" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (path.startsWith("/api/failed-saves/") && req.method === "DELETE") {
        const id = path.replace("/api/failed-saves/", "");
        const removed = await removeFailedSave(id);
        if (!removed) {
          return new Response(JSON.stringify({ error: "Failed save not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ status: "deleted", id }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Static file serving
      if (path === "/" || path === "/index.html") {
        const file = Bun.file("public/index.html");
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html" },
          });
        }
        return new Response("Frontend not found. Create public/index.html", {
          status: 404,
        });
      }

      // Serve other static files from public/
      const filePath = `public${path}`;
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const ext = path.split(".").pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
          html: "text/html",
          js: "application/javascript",
          css: "text/css",
          json: "application/json",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          svg: "image/svg+xml",
          ico: "image/x-icon",
        };
        return new Response(file, {
          headers: {
            "Content-Type": mimeTypes[ext || ""] || "text/plain",
          },
        });
      }

      // 404
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Server error:", error);
      return new Response(
        JSON.stringify({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
});

console.log(`🚀 Invoice Processor Server running at http://localhost:${server.port}`);
console.log(`📁 Static files served from public/`);
console.log(`🔌 API endpoints:`);
console.log(`   POST /api/upload - Upload invoice files`);
console.log(`   GET  /api/keys   - List API keys`);
console.log(`   POST /api/keys   - Add API key`);
console.log(`   DELETE /api/keys/:id - Delete API key`);
console.log(`   GET  /api/databases - List shared databases`);
console.log(`   POST /api/databases/select - Select a database`);
console.log(`   GET  /api/failed-saves - List failed Notion saves`);
console.log(`   POST /api/failed-saves/retry-all - Retry all failed saves`);
console.log(`   POST /api/failed-saves/:id/retry - Retry single failed save`);
console.log(`   POST /api/failed-saves/clear - Clear all failed saves`);
console.log("");

// Run health check on startup
healthCheck();
