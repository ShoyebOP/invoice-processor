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
    if (newLines.length > 0 && newLines[newLines.length - 1] !== "") {
      newLines.push("");
    }
    newLines.push(`${key}=${value}`);
  }

  writeFileSync(ENV_FILE, newLines.join("\n"));
}

/**
 * List all databases shared with this integration
 */
export async function listSharedDatabases(): Promise<Array<{ id: string; name: string; url: string }>> {
  const notion = getClient();

  try {
    const response = await notion.search({
      filter: {
        property: "object",
        value: "data_source",
      },
    });

    const databases: Array<{ id: string; name: string; url: string }> = [];

    for (const result of response.results) {
      // Results can be database objects or data_source objects
      const obj = result as any;
      const id = obj.id;

      // Get the name from title or name field
      let name = "Unnamed Database";
      if (obj.title && Array.isArray(obj.title) && obj.title.length > 0) {
        name = obj.title.map((t: any) => t.plain_text || t.text?.content || "").join("").trim() || "Unnamed Database";
      } else if (obj.name) {
        name = obj.name;
      }

      const url = obj.url || `https://notion.so/${id.replace(/-/g, "")}`;

      databases.push({ id, name, url });
    }

    return databases;
  } catch (error) {
    console.error("Error listing databases:", error);
    return [];
  }
}

/**
 * Select a database and save its ID to .env
 */
export async function selectDatabase(id: string): Promise<{ id: string; name: string }> {
  const notion = getClient();

  // Validate the database exists and is accessible
  try {
    const db = await notion.databases.retrieve({ database_id: id });
    const title = (db as any).title || [];
    const name = title.map((t: any) => t.plain_text || t.text?.content || "").join("").trim() || "Unnamed Database";

    // Save to .env
    updateEnvFile("NOTION_DATABASE_ID", id);
    // Update runtime env
    Bun.env.NOTION_DATABASE_ID = id;
    process.env.NOTION_DATABASE_ID = id;
    cachedDatabaseId = id;

    // Ensure the database schema has all required columns
    const schemaResult = await ensureDatabaseSchema(id);

    return { id, name, ...(schemaResult.schemaWarnings.length > 0 ? { warnings: schemaResult.schemaWarnings } : {}) };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Cannot access database: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Required columns for the transaction ledger
 */
const REQUIRED_COLUMNS = [
  { name: "Date", type: "date" as const },
  { name: "Transaction Type", type: "select" as const },
  { name: "Amount", type: "number" as const },
  { name: "Invoice ID", type: "rich_text" as const },
  { name: "Parties", type: "rich_text" as const },
  { name: "Summary", type: "rich_text" as const },
  { name: "See Full", type: "rich_text" as const },
];

/**
 * Ensure the database has all required columns. Adds missing ones.
 * Warns if columns exist with wrong types.
 */
export async function ensureDatabaseSchema(databaseId: string): Promise<{ schemaWarnings: string[] }> {
  const notion = getClient();
  const warnings: string[] = [];

  try {
    const db = await notion.databases.retrieve({ database_id: databaseId });
    const properties = (db as any).properties || {};

    // Find the title property and rename it to "Title" if needed
    let titlePropName = "Title";
    let titlePropId: string | null = null;
    for (const [propName, propValue] of Object.entries(properties)) {
      const prop = propValue as any;
      if (prop.type === "title") {
        titlePropId = prop.id;
        if (propName !== "Title") {
          titlePropName = propName;
        }
        break;
      }
    }

    // Build the update payload
    const updatePayload: Record<string, any> = {};

    // Rename title property if needed
    if (titlePropName && titlePropName !== "Title") {
      updatePayload[titlePropName] = {
        name: "Title",
      };
      warnings.push(`Renamed "${titlePropName}" → "Title"`);
    }

    // Check and add required columns
    for (const col of REQUIRED_COLUMNS) {
      const existingProp = properties[col.name];

      if (!existingProp) {
        // Column doesn't exist — add it
        updatePayload[col.name] = buildPropertyDefinition(col.type);
      } else {
        const existingType = (existingProp as any).type;
        if (existingType !== col.type) {
          // Column exists but wrong type — create alternative
          const fallbackName = `${col.name} (Txn)`;
          if (!properties[fallbackName]) {
            updatePayload[fallbackName] = buildPropertyDefinition(col.type);
            warnings.push(`"${col.name}" exists as ${existingType}, created "${fallbackName}" instead`);
          }
        }
      }
    }

    // Apply updates if needed
    if (Object.keys(updatePayload).length > 0) {
      await notion.databases.update({
        database_id: databaseId,
        ...updatePayload,
      });
      console.log(`📊 Database schema updated: ${Object.keys(updatePayload).length} changes applied`);
    }

    return { schemaWarnings: warnings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    warnings.push(`Schema update failed: ${msg}`);
    return { schemaWarnings: warnings };
  }
}

/**
 * Build a property definition for database update
 */
function buildPropertyDefinition(type: string): any {
  switch (type) {
    case "date":
      return { date: {} };
    case "select":
      return {
        select: {
          options: [
            { name: "Expense", color: "red" },
            { name: "Income", color: "green" },
          ],
        },
      };
    case "number":
      return { number: { format: "number" } };
    case "rich_text":
      return { rich_text: {} };
    default:
      return { rich_text: {} };
  }
}

/**
 * Get the database ID from cache or env. Returns null if not set.
 */
export async function getDatabaseId(): Promise<string | null> {
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

  return null;
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
  const databaseId = await getDatabaseId();

  if (!databaseId) {
    throw new Error(
      "No database selected.\n\n" +
      "To fix:\n" +
      "1. Create a table in Notion (or use an existing one)\n" +
      "2. Share it with your integration (••• → Add connections)\n" +
      "3. Go to http://localhost:3000 and select the database in the Database section"
    );
  }

  const notion = getClient();

  // Determine the actual column names — use fallback names if schema migration created them
  const db = await notion.databases.retrieve({ database_id: databaseId });
  const properties = (db as any).properties || {};

  // Helper to get the actual column name (original or fallback)
  const colName = (base: string, fallback: string): string => {
    return properties[base] && properties[base].type === getExpectedType(base) ? base :
           properties[fallback] ? fallback : base;
  };

  // Step 1: Create the database entry (row in the ledger table)
  const txnTypeCol = colName("Transaction Type", "Transaction Type (Txn)");
  const amountCol = colName("Amount", "Amount (Txn)");
  const dateCol = colName("Date", "Date (Txn)");
  const partiesCol = colName("Parties", "Parties (Txn)");
  const summaryCol = colName("Summary", "Summary (Txn)");
  const seeFullCol = colName("See Full", "See Full (Txn)");
  const invoiceIdCol = colName("Invoice ID", "Invoice ID (Txn)");

  const dbEntry = await notion.pages.create({
    parent: {
      type: "database_id",
      database_id: databaseId,
    },
    properties: {
      Title: {
        title: [{ text: { content: invoice.invoiceNumber } }],
      },
      [dateCol]: {
        date: { start: invoice.date },
      },
      [txnTypeCol]: {
        select: {
          name: invoice.transactionType === "income" ? "Income" : "Expense",
        },
      },
      [amountCol]: {
        number: invoice.signedAmount,
      },
      [invoiceIdCol]: {
        rich_text: invoice.invoiceId ? [{ type: "text", text: { content: invoice.invoiceId } }] : [],
      },
      [partiesCol]: {
        rich_text: [{ type: "text", text: { content: invoice.parties } }],
      },
      [summaryCol]: {
        rich_text: [{ type: "text", text: { content: invoice.summary } }],
      },
    },
  });

  const dbEntryPageId = dbEntry.id;

  // Step 2: Create the child page with full invoice details
  const childPageId = await createFullInvoicePage(dbEntryPageId, invoice);
  const childPageUrl = `https://notion.so/${childPageId.replace(/-/g, "")}`;

  // Step 3: Update the "See Full" property with a clickable link
  await notion.pages.update({
    page_id: dbEntryPageId,
    properties: {
      [seeFullCol]: {
        rich_text: [
          {
            type: "text",
            text: { content: "see full", link: { url: childPageUrl } },
            annotations: { color: "blue", underline: true },
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

/**
 * Get the expected type for a column name (for schema detection)
 */
function getExpectedType(colName: string): string {
  const map: Record<string, string> = {
    "Date": "date",
    "Transaction Type": "select",
    "Amount": "number",
    "Invoice ID": "rich_text",
    "Parties": "rich_text",
    "Summary": "rich_text",
    "See Full": "rich_text",
  };
  return map[colName] || "rich_text";
}
