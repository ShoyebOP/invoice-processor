import type { InvoiceData } from "../types.ts";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";

const CACHE_FILE = "./data/failed_notion_saves.json";

export interface FailedNotionSave {
  id: string;
  fileName: string;
  invoiceData: InvoiceData;
  errorMessage: string;
  failedAt: string; // ISO date string
  retryCount: number;
}

/**
 * Ensure the data directory exists
 */
function ensureDataDir() {
  if (!existsSync("data")) {
    mkdirSync("data", { recursive: true });
  }
}

/**
 * Load all failed Notion saves from disk
 */
export async function loadFailedSaves(): Promise<FailedNotionSave[]> {
  try {
    ensureDataDir();
    if (!existsSync(CACHE_FILE)) {
      return [];
    }
    const text = readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(text) as FailedNotionSave[];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Save all failed Notion saves to disk
 */
async function saveFailedSaves(failed: FailedNotionSave[]): Promise<void> {
  ensureDataDir();
  writeFileSync(CACHE_FILE, JSON.stringify(failed, null, 2));
}

/**
 * Add a failed save to the cache
 */
export async function addFailedSave(
  fileName: string,
  invoiceData: InvoiceData,
  errorMessage: string
): Promise<FailedNotionSave> {
  const failed = await loadFailedSaves();

  const entry: FailedNotionSave = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    invoiceData,
    errorMessage,
    failedAt: new Date().toISOString(),
    retryCount: 0,
  };

  failed.push(entry);
  await saveFailedSaves(failed);

  return entry;
}

/**
 * Remove a failed save by ID (after successful retry)
 */
export async function removeFailedSave(id: string): Promise<boolean> {
  const failed = await loadFailedSaves();
  const filtered = failed.filter((f) => f.id !== id);

  if (filtered.length === failed.length) {
    return false; // ID not found
  }

  await saveFailedSaves(filtered);
  return true;
}

/**
 * Mark a failed save as retried (increment retryCount)
 */
export async function incrementRetryCount(id: string): Promise<void> {
  const failed = await loadFailedSaves();
  const entry = failed.find((f) => f.id === id);
  if (entry) {
    entry.retryCount += 1;
    await saveFailedSaves(failed);
  }
}

/**
 * Clear all failed saves
 */
export async function clearAllFailedSaves(): Promise<void> {
  ensureDataDir();
  await saveFailedSaves([]);
}
