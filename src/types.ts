// Invoice data structure extracted by Gemini
export interface InvoiceData {
  // Ledger fields (for the database table row)
  transactionType: "income" | "expense";
  signedAmount: number; // negative for expense, positive for income
  invoiceId: string | null;
  date: string; // YYYY-MM-DD
  parties: string; // "Vendor → Customer"
  summary: string; // one-line transaction description

  // Full invoice fields (for the nested child page)
  invoiceNumber: string;
  dueDate?: string; // YYYY-MM-DD
  vendor: {
    name: string;
    address?: string;
    email?: string;
    phone?: string;
  };
  customer: {
    name: string;
    address?: string;
  };
  lineItems: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string; // ISO currency code (USD, EUR, etc.)
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface FileUpload {
  base64: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface ProcessResult {
  success: boolean;
  fileName: string;
  invoiceData?: InvoiceData;
  error?: string;
  notionPageId?: string;
}

export interface APIKeyInfo {
  id: string;
  lastUsed: Date | null;
  requestCount: number;
}

export interface APIKeyWithSecret extends APIKeyInfo {
  key: string;
}
