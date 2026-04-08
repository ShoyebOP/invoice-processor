import { Client } from "@notionhq/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { InvoiceData } from "../types.ts";

const ENV_FILE = ".env";

let notionClient: Client | null = null;
let cachedDataSourceId: string | null = null;

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

function readEnvFile(): string {
  if (!existsSync(ENV_FILE)) {
    return "";
  }
  return readFileSync(ENV_FILE, "utf-8");
}

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
 * Clear the database selection from .env
 */
export function clearDatabaseSelection(): void {
  updateEnvFile("NOTION_DATABASE_ID", "");
  Bun.env.NOTION_DATABASE_ID = "";
  process.env.NOTION_DATABASE_ID = "";
  cachedDataSourceId = null;
  console.log("🗑️  Database selection cleared");
}

/**
 * List all data sources (databases) shared with this integration.
 * For each result, we get the data_source_id AND the parent database_id.
 */
export async function listSharedDatabases(): Promise<Array<{ dataSourceId: string; databaseId: string; name: string }>> {
  const notion = getClient();

  const response = await notion.search({
    filter: {
      property: "object",
      value: "data_source",
    },
  });

  const databases: Array<{ dataSourceId: string; databaseId: string; name: string }> = [];

  for (const result of response.results) {
    const obj = result as any;
    const dataSourceId = obj.id;

    // Get parent database_id — it's nested under parent.database_id
    let databaseId = "";
    if (obj.parent && obj.parent.database_id) {
      databaseId = obj.parent.database_id;
    } else {
      // Fallback: if there's no parent info, use the data_source_id as databaseId
      // (they might be the same in some API versions)
      databaseId = dataSourceId;
    }

    let name = "Unnamed Database";
    if (obj.name) {
      name = obj.name;
    } else if (obj.title && Array.isArray(obj.title) && obj.title.length > 0) {
      name = obj.title.map((t: any) => t.plain_text || t.text?.content || "").join("").trim() || "Unnamed Database";
    }

    databases.push({ dataSourceId, databaseId, name });

    console.log(`  📋 Found database: "${name}"`);
    console.log(`     data_source_id: ${dataSourceId}`);
    console.log(`     database_id:    ${databaseId}`);
  }

  return databases;
}

/**
 * Select a database (data source), ensure schema exists, save to .env
 */
export async function selectDatabase(dataSourceId: string): Promise<{ id: string; name: string; schemaWarnings: string[] }> {
  // Find the matching data source to get its database_id
  const allDataSources = await listSharedDatabases();
  const selected = allDataSources.find((ds) => ds.dataSourceId === dataSourceId);

  if (!selected) {
    throw new Error("Data source not found. Make sure it's shared with your integration.");
  }

  console.log(`\n📊 Selecting database: "${selected.name}"`);
  console.log(`   data_source_id: ${selected.dataSourceId}`);
  console.log(`   database_id:    ${selected.databaseId}`);

  // Ensure the database schema has all required columns
  const schemaResult = await ensureDatabaseSchema(selected.databaseId);

  // Save the data_source_id to .env
  updateEnvFile("NOTION_DATABASE_ID", dataSourceId);
  Bun.env.NOTION_DATABASE_ID = dataSourceId;
  process.env.NOTION_DATABASE_ID = dataSourceId;
  cachedDataSourceId = dataSourceId;

  console.log(`   ✅ Schema warnings: ${schemaResult.schemaWarnings.length > 0 ? schemaResult.schemaWarnings.join(", ") : "none"}`);
  console.log(`   ✅ Database ID saved to .env\n`);

  return { id: dataSourceId, name: selected.name, schemaWarnings: schemaResult.schemaWarnings };
}

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
 * Ensure the database has all required columns. Adds missing ones via PATCH /v1/databases/{id}.
 * Warns if columns exist with wrong types.
 */
export async function ensureDatabaseSchema(databaseId: string): Promise<{ schemaWarnings: string[] }> {
  const notion = getClient();
  const warnings: string[] = [];

  console.log(`\n🔧 Checking database schema for: ${databaseId}`);

  let properties: Record<string, any>;
  try {
    const db = await notion.databases.retrieve({ database_id: databaseId });
    properties = (db as any).properties || {};
    console.log(`   Existing columns: ${Object.keys(properties).join(", ")}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    warnings.push(`Could not retrieve database: ${msg}`);
    console.error(`   ❌ Could not retrieve database: ${msg}`);
    return { schemaWarnings: warnings };
  }

  // Find the title property and rename it to "Title" if needed
  let titlePropName = "Title";
  for (const [propName, propValue] of Object.entries(properties)) {
    const prop = propValue as any;
    if (prop.type === "title") {
      if (propName !== "Title") {
        titlePropName = propName;
      }
      break;
    }
  }

  // Build the update payload — all column changes go under "properties"
  const updatePayload: Record<string, any> = {};

  // Rename title property if needed
  if (titlePropName && titlePropName !== "Title") {
    updatePayload[titlePropName] = { name: "Title" };
    warnings.push(`Renamed "${titlePropName}" → "Title"`);
  }

  // Check and add required columns
  for (const col of REQUIRED_COLUMNS) {
    const existingProp = properties[col.name];

    if (!existingProp) {
      updatePayload[col.name] = buildPropertyDefinition(col.type);
      console.log(`   ➕ Adding column: "${col.name}" (${col.type})`);
    } else {
      const existingType = (existingProp as any).type;
      if (existingType !== col.type) {
        const fallbackName = `${col.name} (Txn)`;
        if (!properties[fallbackName]) {
          updatePayload[fallbackName] = buildPropertyDefinition(col.type);
          warnings.push(`"${col.name}" exists as ${existingType}, created "${fallbackName}" instead`);
          console.log(`   ➕ Adding fallback column: "${fallbackName}" (${col.type})`);
        }
      }
    }
  }

  // Apply updates
  if (Object.keys(updatePayload).length > 0) {
    console.log(`   📝 Updating database with ${Object.keys(updatePayload).length} changes...`);
    try {
      await notion.request({
        method: "patch",
        path: `databases/${databaseId}`,
        body: {
          properties: updatePayload,
        },
      });
      console.log(`   ✅ Database schema updated successfully`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      warnings.push(`Schema update failed: ${msg}`);
      console.error(`   ❌ Schema update failed: ${msg}`);
    }
  } else {
    console.log(`   ✅ All required columns already exist`);
  }

  return { schemaWarnings: warnings };
}

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

export async function getDataSourceId(): Promise<string | null> {
  if (cachedDataSourceId) {
    return cachedDataSourceId;
  }

  const envId = Bun.env.NOTION_DATABASE_ID?.trim();
  if (envId && envId.length > 0) {
    cachedDataSourceId = envId;
    return cachedDataSourceId;
  }

  return null;
}

async function createFullInvoicePage(parentPageId: string, invoice: InvoiceData): Promise<string> {
  const notion = getClient();
  const blocks: any[] = [];

  const vendorParts = [`**Vendor:** ${invoice.vendor.name}`];
  if (invoice.vendor.address) vendorParts.push(`**Address:** ${invoice.vendor.address}`);
  if (invoice.vendor.email) vendorParts.push(`**Email:** ${invoice.vendor.email}`);
  if (invoice.vendor.phone) vendorParts.push(`**Phone:** ${invoice.vendor.phone}`);

  blocks.push({
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ type: "text", text: { content: "Vendor Details" } }] },
  });

  blocks.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: vendorParts.map((text: string) => ({
        type: "text" as const,
        text: { content: text + "\n" },
      })),
    },
  });

  if (invoice.customer.name) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Customer" } }] },
    });

    const customerParts = [`**Name:** ${invoice.customer.name}`];
    if (invoice.customer.address) customerParts.push(`**Address:** ${invoice.customer.address}`);

    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: customerParts.map((text: string) => ({
          type: "text" as const,
          text: { content: text + "\n" },
        })),
      },
    });
  }

  if (invoice.lineItems.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Line Items" } }] },
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

  blocks.push({ object: "block", type: "divider", divider: {} });

  blocks.push({
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ type: "text", text: { content: "Totals" } }] },
  });

  blocks.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { type: "text", text: { content: `Subtotal: ${invoice.currency} ${invoice.subtotal.toFixed(2)}\n` } },
        { type: "text", text: { content: `Tax: ${invoice.currency} ${invoice.tax.toFixed(2)}\n` } },
        { type: "text", annotations: { bold: true }, text: { content: `Total: ${invoice.currency} ${invoice.total.toFixed(2)}` } },
      ],
    },
  });

  const childPage = await notion.pages.create({
    parent: { type: "page_id", page_id: parentPageId },
    properties: {
      title: {
        title: [{ type: "text", text: { content: `Full Invoice — ${invoice.invoiceNumber}` } }],
      },
    },
    children: blocks,
  });

  return childPage.id;
}

async function resolveColumnName(dataSourceId: string, baseName: string, fallbackName: string): Promise<string> {
  const allDataSources = await listSharedDatabases();
  const ds = allDataSources.find((d) => d.dataSourceId === dataSourceId);
  if (!ds) return baseName;

  const notion = getClient();
  const db = await notion.databases.retrieve({ database_id: ds.databaseId });
  const properties = (db as any).properties || {};

  if (properties[baseName]) return baseName;
  if (properties[fallbackName]) return fallbackName;
  return baseName;
}

export async function createInvoicePage(invoice: InvoiceData): Promise<string> {
  const dataSourceId = await getDataSourceId();

  if (!dataSourceId) {
    throw new Error(
      "No database selected.\n\n" +
      "To fix:\n" +
      "1. Create a table in Notion (or use an existing one)\n" +
      "2. Share it with your integration (••• → Add connections)\n" +
      "3. Go to http://localhost:3000 and select the database in the Database section"
    );
  }

  const notion = getClient();

  const txnTypeCol = await resolveColumnName(dataSourceId, "Transaction Type", "Transaction Type (Txn)");
  const amountCol = await resolveColumnName(dataSourceId, "Amount", "Amount (Txn)");
  const dateCol = await resolveColumnName(dataSourceId, "Date", "Date (Txn)");
  const partiesCol = await resolveColumnName(dataSourceId, "Parties", "Parties (Txn)");
  const summaryCol = await resolveColumnName(dataSourceId, "Summary", "Summary (Txn)");
  const seeFullCol = await resolveColumnName(dataSourceId, "See Full", "See Full (Txn)");
  const invoiceIdCol = await resolveColumnName(dataSourceId, "Invoice ID", "Invoice ID (Txn)");

  const dbEntry = await notion.request({
    method: "post",
    path: "pages",
    body: {
      parent: {
        type: "data_source_id",
        data_source_id: dataSourceId,
      },
      properties: {
        Title: { title: [{ type: "text", text: { content: invoice.invoiceNumber } }] },
        [dateCol]: { date: { start: invoice.date } },
        [txnTypeCol]: { select: { name: invoice.transactionType === "income" ? "Income" : "Expense" } },
        [amountCol]: { number: invoice.signedAmount },
        [invoiceIdCol]: { rich_text: invoice.invoiceId ? [{ type: "text", text: { content: invoice.invoiceId } }] : [] },
        [partiesCol]: { rich_text: [{ type: "text", text: { content: invoice.parties } }] },
        [summaryCol]: { rich_text: [{ type: "text", text: { content: invoice.summary } }] },
      },
    },
  });

  const dbEntryPageId = (dbEntry as any).id;

  const childPageId = await createFullInvoicePage(dbEntryPageId, invoice);
  const childPageUrl = `https://notion.so/${childPageId.replace(/-/g, "")}`;

  await notion.pages.update({
    page_id: dbEntryPageId,
    properties: {
      [seeFullCol]: {
        rich_text: [{ type: "text", text: { content: "see full", link: { url: childPageUrl } }, annotations: { color: "blue", underline: true } }],
      },
    },
  });

  console.log(
    `✅ Created ledger entry for ${invoice.invoiceNumber} (${invoice.transactionType}, ${invoice.currency} ${invoice.signedAmount}) → child page: ${childPageId}`
  );

  return dbEntryPageId;
}
