import { Client } from "@notionhq/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { InvoiceData, LineItem } from "../types.ts";

const ENV_FILE = ".env";

// Lazy-initialized Notion client
let notionClient: Client | null = null;
let cachedDatabaseId: string | null = null;

function getClient(): Client {
  if (!notionClient) {
    const apiKey = Bun.env.NOTION_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "NOTION_API_KEY not set in environment.\n" +
        "Please add your Notion integration token to the .env file.\n" +
        "Get one at: https://www.notion.so/my-integrations"
      );
    }
    notionClient = new Client({ auth: apiKey });
  }
  return notionClient;
}

/**
 * Read the current .env file content
 */
function readEnvFile(): string {
  if (!existsSync(ENV_FILE)) {
    return "";
  }
  return readFileSync(ENV_FILE, "utf-8");
}

/**
 * Update a key in the .env file while preserving comments and formatting
 */
function updateEnvFile(key: string, value: string): void {
  const content = readEnvFile();
  const lines = content.split("\n");
  const newLines: string[] = [];
  let found = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(key + "=") || trimmed.startsWith(key + " =")) {
      newLines.push(`${key}=${value}`);
      found = true;
    } else {
      newLines.push(line);
    }
  }

  if (!found) {
    // Append the key if it wasn't found
    if (newLines.length > 0 && newLines[newLines.length - 1] !== "") {
      newLines.push("");
    }
    newLines.push(`${key}=${value}`);
  }

  writeFileSync(ENV_FILE, newLines.join("\n"));
}

/**
 * Get the database ID — from cache, env var, or auto-create and persist to .env
 */
async function getDatabaseId(): Promise<string> {
  // Return cached ID if available
  if (cachedDatabaseId) {
    return cachedDatabaseId;
  }

  // Check env var
  const envDatabaseId = Bun.env.NOTION_DATABASE_ID?.trim();
  if (envDatabaseId && envDatabaseId.length > 0) {
    cachedDatabaseId = envDatabaseId;
    return cachedDatabaseId;
  }

  // Auto-create database and persist ID to .env
  const database = await createInvoiceDatabase();
  cachedDatabaseId = database.id;

  // Write the database ID back to .env for future use
  try {
    updateEnvFile("NOTION_DATABASE_ID", database.id);
    // Also update runtime env so subsequent requests don't re-read .env
    Bun.env.NOTION_DATABASE_ID = database.id;
    process.env.NOTION_DATABASE_ID = database.id;
    console.log(`📊 Database ID saved to .env: ${database.id}`);
  } catch (error) {
    console.warn("Warning: Could not write database ID to .env:", error);
  }

  return cachedDatabaseId;
}

/**
 * Find the first page shared with this integration to use as parent
 */
async function findParentPage(): Promise<string> {
  const notion = getClient();

  // Prefer to use a page from env if specified
  const envParentId = Bun.env.NOTION_PAGE_ID?.trim();
  if (envParentId) {
    return envParentId;
  }

  let pages;
  try {
    pages = await notion.search({
      filter: {
        property: "object",
        value: "page",
      },
      page_size: 1,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("401")) {
      throw new Error(
        "Notion API token is invalid (401 Unauthorized).\n\n" +
        "How to fix:\n" +
        "1. Go to https://www.notion.so/my-integrations\n" +
        "2. Click on your integration → 'Internal Integration' tab\n" +
        "3. Copy the token (starts with 'ntn_')\n" +
        "4. Paste it in your .env file as NOTION_API_KEY\n" +
        "5. DO NOT click 'Refresh' unless your token was exposed\n" +
        "6. Restart the server\n\n" +
        `Technical details: ${error.message}`
      );
    }
    throw error;
  }

  if (pages.results.length === 0) {
    throw new Error(
      "No pages found in your Notion workspace that are shared with this integration.\n\n" +
      "How to fix:\n" +
      "1. Open Notion and go to any page (or create a new one)\n" +
      "2. Click '•••' (three dots) in the top-right of the page\n" +
      "3. Click 'Add connections' (or 'Connect to')\n" +
      "4. Search for your integration name and select it\n" +
      "5. Restart the server"
    );
  }

  return pages.results[0].id;
}

/**
 * Create an invoice transaction ledger database under a parent page
 * Returns the database object
 */
async function createInvoiceDatabase() {
  const notion = getClient();
  const parentPageId = await findParentPage();

  const database = await notion.databases.create({
    parent: {
      type: "page_id",
      page_id: parentPageId,
    },
    title: [
      {
        type: "text",
        text: {
          content: "Transaction Ledger",
        },
      },
    ],
    description: [
      {
        type: "text",
        text: {
          content: "Invoices processed by Gemini AI — each row links to a full invoice page",
        },
      },
    ],
    initial_data_source: {
      properties: {
        // Title column — shows as the main identifier in table view
        Title: {
          type: "title",
          title: {},
        },
        Date: {
          type: "date",
          date: {},
        },
        "Transaction Type": {
          type: "select",
          select: {
            options: [
              { name: "Expense", color: "red" },
              { name: "Income", color: "green" },
            ],
          },
        },
        Amount: {
          type: "number",
          number: {
            format: "number",
          },
        },
        "Invoice ID": {
          type: "rich_text",
          rich_text: {},
        },
        Parties: {
          type: "rich_text",
          rich_text: {},
        },
        Summary: {
          type: "rich_text",
          rich_text: {},
        },
        "See Full": {
          type: "rich_text",
          rich_text: {},
        },
      },
    },
  });

  console.log(`📊 Created transaction ledger database under page ${parentPageId}`);
  return database;
}

/**
 * Create a child page under a database entry page with the full invoice details
 */
async function createFullInvoicePage(parentPageId: string, invoice: InvoiceData): Promise<string> {
  const notion = getClient();

  // Build the full invoice content as blocks
  const blocks: any[] = [];

  // Vendor details
  const vendorParts = [`**Vendor:** ${invoice.vendor.name}`];
  if (invoice.vendor.address) vendorParts.push(`**Address:** ${invoice.vendor.address}`);
  if (invoice.vendor.email) vendorParts.push(`**Email:** ${invoice.vendor.email}`);
  if (invoice.vendor.phone) vendorParts.push(`**Phone:** ${invoice.vendor.phone}`);

  blocks.push({
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: "Vendor Details" } }],
    },
  });

  blocks.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: vendorParts.map((text) => ({
        type: "text" as const,
        text: { content: text + "\n" },
      })),
    },
  });

  // Customer details
  if (invoice.customer.name) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Customer" } }],
      },
    });

    const customerParts = [`**Name:** ${invoice.customer.name}`];
    if (invoice.customer.address) customerParts.push(`**Address:** ${invoice.customer.address}`);

    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: customerParts.map((text) => ({
          type: "text" as const,
          text: { content: text + "\n" },
        })),
      },
    });
  }

  // Line items
  if (invoice.lineItems.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Line Items" } }],
      },
    });

    for (const item of invoice.lineItems) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: {
                content: `${item.description} — Qty: ${item.quantity} × ${invoice.currency} ${item.unitPrice.toFixed(2)} = ${invoice.currency} ${item.total.toFixed(2)}`,
              },
            },
          ],
        },
      });
    }
  }

  // Financial summary
  blocks.push({
    object: "block",
    type: "divider",
    divider: {},
  });

  blocks.push({
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: "Totals" } }],
    },
  });

  blocks.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { type: "text", text: { content: `Subtotal: ${invoice.currency} ${invoice.subtotal.toFixed(2)}\n` } },
        { type: "text", text: { content: `Tax: ${invoice.currency} ${invoice.tax.toFixed(2)}\n` } },
        {
          type: "text",
          annotations: { bold: true },
          text: { content: `Total: ${invoice.currency} ${invoice.total.toFixed(2)}` },
        },
      ],
    },
  });

  // Create the child page
  const childPage = await notion.pages.create({
    parent: {
      type: "page_id",
      page_id: parentPageId,
    },
    properties: {
      title: {
        title: [
          {
            type: "text",
            text: { content: `Full Invoice — ${invoice.invoiceNumber}` },
          },
        ],
      },
    },
    children: blocks,
  });

  return childPage.id;
}

/**
 * Create a new row in the transaction ledger database with a child page for full details.
 * Step 1: Create database entry (row in table)
 * Step 2: Create child page with full invoice details
 * Step 3: Update the "See Full" property with a link to the child page
 */
export async function createInvoicePage(invoice: InvoiceData): Promise<string> {
  const notion = getClient();
  const databaseId = await getDatabaseId();

  // Step 1: Create the database entry (row in the ledger table)
  // Start without the "See Full" field — we'll add it after creating the child page
  const properties: Record<string, any> = {
    Title: {
      title: [
        {
          text: {
            content: invoice.invoiceNumber,
          },
        },
      ],
    },
    Date: {
      date: {
        start: invoice.date,
      },
    },
    "Transaction Type": {
      select: {
        name: invoice.transactionType === "income" ? "Income" : "Expense",
      },
    },
    Amount: {
      number: invoice.signedAmount,
    },
    "Invoice ID": {
      rich_text: invoice.invoiceId
        ? [{ type: "text", text: { content: invoice.invoiceId } }]
        : [],
    },
    Parties: {
      rich_text: [
        {
          type: "text",
          text: { content: invoice.parties },
        },
      ],
    },
    Summary: {
      rich_text: [
        {
          type: "text",
          text: { content: invoice.summary },
        },
      ],
    },
  };

  const dbEntry = await notion.pages.create({
    parent: {
      type: "database_id",
      database_id: databaseId,
    },
    properties,
  });

  const dbEntryPageId = dbEntry.id;

  // Step 2: Create the child page with full invoice details
  const childPageId = await createFullInvoicePage(dbEntryPageId, invoice);

  // Get the child page URL
  const childPageUrl = `https://notion.so/${childPageId.replace(/-/g, "")}`;

  // Step 3: Update the "See Full" property with a clickable link
  await notion.pages.update({
    page_id: dbEntryPageId,
    properties: {
      "See Full": {
        rich_text: [
          {
            type: "text",
            text: {
              content: "see full",
              link: {
                url: childPageUrl,
              },
            },
            annotations: {
              color: "blue",
              underline: true,
            },
          },
        ],
      },
    },
  });

  console.log(
    `✅ Created ledger entry for ${invoice.invoiceNumber} (${invoice.transactionType}, ${invoice.currency} ${invoice.signedAmount}) → child page: ${childPageId}`
  );

  return dbEntryPageId;
}
