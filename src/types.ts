// Invoice data structure extracted by Gemini
export interface InvoiceData {
  invoiceNumber: string;
  date: string; // YYYY-MM-DD
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
