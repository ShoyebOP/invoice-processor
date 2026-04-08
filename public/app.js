// State
const state = {
  files: [],
  isProcessing: false,
  isRetrying: false,
};

// DOM Elements
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const fileList = document.getElementById("file-list");
const processBtn = document.getElementById("process-btn");
const btnText = processBtn.querySelector(".btn-text");
const btnLoader = processBtn.querySelector(".btn-loader");
const resultsSection = document.getElementById("results-section");
const summaryDiv = document.getElementById("summary");
const resultsDiv = document.getElementById("results");
const failedSavesSection = document.getElementById("failed-saves-section");
const failedCount = document.getElementById("failed-count");
const failedSavesEmpty = document.getElementById("failed-saves-empty");
const failedSavesContent = document.getElementById("failed-saves-content");
const failedSavesList = document.getElementById("failed-saves-list");
const retryAllBtn = document.getElementById("retry-all-btn");
const clearFailedBtn = document.getElementById("clear-failed-btn");
const keyInput = document.getElementById("key-input");
const addKeyBtn = document.getElementById("add-key-btn");
const keysTable = document.getElementById("keys-table");
const keysTbody = document.getElementById("keys-tbody");
const keysMessage = document.getElementById("keys-message");

// Utility: format file size
function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

// Utility: format date
function formatDate(dateStr) {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  return date.toLocaleString();
}

// File Management
function addFile(file) {
  state.files.push(file);
  renderFileList();
}

function removeFile(index) {
  state.files.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  if (state.files.length === 0) {
    fileList.innerHTML = "";
    processBtn.disabled = true;
    return;
  }

  processBtn.disabled = false;
  fileList.innerHTML = state.files
    .map(
      (file, index) => `
    <div class="file-item">
      <div class="file-info">
        <span class="file-icon">${getFileIcon(file.name)}</span>
        <div>
          <div class="file-name">${escapeHtml(file.name)}</div>
          <div class="file-size">${formatSize(file.size)}</div>
        </div>
      </div>
      <button class="file-remove" onclick="removeFile(${index})" title="Remove">✕</button>
    </div>
  `
    )
    .join("");
}

function getFileIcon(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "📄";
  return "🖼️";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Drag & Drop
dropZone.addEventListener("click", () => fileInput.click());

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const files = Array.from(e.dataTransfer.files);
  files.forEach((file) => addFile(file));
});

fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files || []);
  files.forEach((file) => addFile(file));
  fileInput.value = ""; // Reset so same file can be re-added
});

// Process Button
processBtn.addEventListener("click", async () => {
  if (state.isProcessing || state.files.length === 0) return;

  state.isProcessing = true;
  processBtn.disabled = true;
  btnText.hidden = true;
  btnLoader.hidden = false;
  resultsSection.hidden = true;

  try {
    const formData = new FormData();
    state.files.forEach((file) => formData.append("files", file));

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Upload failed");
    }

    renderResults(data);
  } catch (error) {
    renderError(error.message);
  } finally {
    state.isProcessing = false;
    processBtn.disabled = false;
    btnText.hidden = false;
    btnLoader.hidden = true;
  }
});

// Results Rendering
function renderResults(data) {
  resultsSection.hidden = false;

  // Summary
  let summaryClass = "success";
  let summaryText = `✅ All ${data.total} files processed successfully!`;

  if (data.failCount > 0 && data.successCount > 0) {
    summaryClass = "partial";
    summaryText = `⚠️ ${data.successCount}/${data.total} succeeded, ${data.failCount} failed`;
  } else if (data.failCount === data.total) {
    summaryClass = "error";
    summaryText = `❌ All ${data.total} files failed to process`;
  }

  summaryDiv.className = `summary ${summaryClass}`;
  summaryDiv.textContent = summaryText;

  // Individual results
  resultsDiv.innerHTML = data.results
    .map((result) => {
      if (result.success) {
        const invoice = result.invoiceData;
        const lineItemsHtml = invoice.lineItems
          .map(
            (item) => `
          <li>${escapeHtml(item.description)} — Qty: ${item.quantity} × ${invoice.currency} ${item.unitPrice.toFixed(2)} = <strong>${invoice.currency} ${item.total.toFixed(2)}</strong></li>
        `
          )
          .join("");

        // Format signed amount with sign indicator
        const amountStr = invoice.signedAmount >= 0
          ? `+${invoice.currency} ${invoice.signedAmount.toFixed(2)}`
          : `-${invoice.currency} ${Math.abs(invoice.signedAmount).toFixed(2)}`;
        const amountColor = invoice.transactionType === "income" ? "var(--success)" : "var(--error)";
        const typeBadge = invoice.transactionType === "income"
          ? '<span style="color: var(--success); font-weight: 600;">▲ Income</span>'
          : '<span style="color: var(--error); font-weight: 600;">▼ Expense</span>';

        return `
          <div class="result-card success">
            <div class="result-header">
              <span class="result-file">${escapeHtml(result.fileName)}</span>
              <span class="status-badge success">✓ Success</span>
            </div>
            <div class="invoice-summary">
              <div class="invoice-field">
                <label>Invoice #</label>
                <value>${escapeHtml(invoice.invoiceId || invoice.invoiceNumber)}</value>
              </div>
              <div class="invoice-field">
                <label>Date</label>
                <value>${invoice.date}</value>
              </div>
              <div class="invoice-field">
                <label>Type</label>
                <value>${typeBadge}</value>
              </div>
              <div class="invoice-field">
                <label>Amount</label>
                <value style="color: ${amountColor}">${amountStr}</value>
              </div>
              <div class="invoice-field">
                <label>Parties</label>
                <value>${escapeHtml(invoice.parties)}</value>
              </div>
              <div class="invoice-field">
                <label>Due Date</label>
                <value>${invoice.dueDate || "Not specified"}</value>
              </div>
            </div>
            <div class="invoice-field" style="margin-top: 0.5rem;">
              <label>Summary</label>
              <value style="font-weight: 400; font-size: 0.85rem;">${escapeHtml(invoice.summary)}</value>
            </div>
            ${
              invoice.lineItems.length > 0
                ? `
              <h4 style="margin-top: 0.75rem; margin-bottom: 0.5rem; font-size: 0.9rem;">Line Items</h4>
              <ol class="line-items-list">${lineItemsHtml}</ol>
              <div style="margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: var(--bg); border-radius: var(--radius); font-size: 0.875rem;">
                <div>Subtotal: ${invoice.currency} ${invoice.subtotal.toFixed(2)}</div>
                <div>Tax: ${invoice.currency} ${invoice.tax.toFixed(2)}</div>
                <div><strong>Total: ${invoice.currency} ${invoice.total.toFixed(2)}</strong></div>
              </div>
            `
                : ""
            }
            ${result.error ? `<div class="message warning" style="margin-top: 0.75rem;">⚠️ ${escapeHtml(result.error)}</div>` : ""}
          </div>
        `;
      } else {
        return `
          <div class="result-card error">
            <div class="result-header">
              <span class="result-file">${escapeHtml(result.fileName)}</span>
              <span class="status-badge error">✗ Failed</span>
            </div>
            <p class="error-message">${escapeHtml(result.error)}</p>
          </div>
        `;
      }
    })
    .join("");

  // Scroll to results
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderError(message) {
  resultsSection.hidden = false;
  summaryDiv.className = "summary error";
  summaryDiv.textContent = "❌ Processing failed";
  resultsDiv.innerHTML = `
    <div class="result-card error">
      <p class="error-message">${escapeHtml(message)}</p>
    </div>
  `;
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// API Key Management
addKeyBtn.addEventListener("click", async () => {
  const key = keyInput.value.trim();
  if (!key) return;

  addKeyBtn.disabled = true;
  addKeyBtn.textContent = "Adding...";

  try {
    const response = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });

    const data = await response.json();

    if (!response.ok) {
      showMessage(data.error || "Failed to add key", "error");
      return;
    }

    showMessage("✅ API key added successfully!", "success");
    keyInput.value = "";
    loadKeys();
  } catch (error) {
    showMessage("Failed to connect to server", "error");
  } finally {
    addKeyBtn.disabled = false;
    addKeyBtn.textContent = "Add Key";
  }
});

// Allow Enter key to add API key
keyInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    addKeyBtn.click();
  }
});

function showMessage(text, type) {
  keysMessage.textContent = text;
  keysMessage.className = `message ${type}`;
  keysMessage.hidden = false;
  setTimeout(() => {
    keysMessage.hidden = true;
  }, 3000);
}

async function loadKeys() {
  try {
    const response = await fetch("/api/keys");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error);
    }

    renderKeys(data.keys);
  } catch (error) {
    console.error("Failed to load keys:", error);
  }
}

function renderKeys(keys) {
  if (keys.length === 0) {
    keysTable.hidden = true;
    return;
  }

  keysTable.hidden = false;
  keysTbody.innerHTML = keys
    .map(
      (keyInfo) => `
    <tr>
      <td><span class="key-id">${escapeHtml(keyInfo.id)}</span></td>
      <td>${keyInfo.requestCount}</td>
      <td>${
        keyInfo.lastUsed
          ? formatDate(keyInfo.lastUsed)
          : '<span class="never-used">Never</span>'
      }</td>
      <td>
        <button class="btn btn-danger" onclick="deleteKey('${keyInfo.id}')">Delete</button>
      </td>
    </tr>
  `
    )
    .join("");
}

async function deleteKey(keyId) {
  if (!confirm("Delete this API key?")) return;

  try {
    const response = await fetch(`/api/keys/${keyId}`, {
      method: "DELETE",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error);
    }

    showMessage("✅ API key deleted", "success");
    loadKeys();
  } catch (error) {
    showMessage("Failed to delete key", "error");
  }
}

// Make functions available globally
window.removeFile = removeFile;
window.deleteKey = deleteKey;
window.retrySingleFailed = retrySingleFailed;

// Failed Saves Management
async function loadFailedSaves() {
  try {
    const response = await fetch("/api/failed-saves");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error);
    }

    renderFailedSaves(data.failed);
  } catch (error) {
    console.error("Failed to load failed saves:", error);
  }
}

function renderFailedSaves(failed) {
  failedCount.textContent = failed.length;

  if (failed.length === 0) {
    failedSavesSection.hidden = true;
    return;
  }

  failedSavesSection.hidden = false;
  failedSavesEmpty.hidden = true;
  failedSavesContent.hidden = false;

  failedSavesList.innerHTML = failed
    .map(
      (entry) => {
        const invoice = entry.invoiceData;
        const amountStr = invoice.signedAmount >= 0
          ? `+${invoice.currency} ${invoice.signedAmount.toFixed(2)}`
          : `-${invoice.currency} ${Math.abs(invoice.signedAmount).toFixed(2)}`;
        const amountColor = invoice.transactionType === "income" ? "var(--success)" : "var(--error)";
        const typeBadge = invoice.transactionType === "income"
          ? '<span style="color: var(--success); font-weight: 600;">▲ Income</span>'
          : '<span style="color: var(--error); font-weight: 600;">▼ Expense</span>';

        return `
    <div class="failed-save-card" id="failed-${entry.id}">
      <div class="failed-save-header">
        <span class="failed-save-file">${escapeHtml(entry.fileName)}</span>
        <div class="failed-save-meta">
          <span>${typeBadge}</span>
          <span style="color: ${amountColor}; font-weight: 600;">${amountStr}</span>
          <span>Retries: ${entry.retryCount}</span>
          <span>${formatDate(entry.failedAt)}</span>
        </div>
      </div>
      <div class="failed-save-error">${escapeHtml(entry.errorMessage)}</div>
      <div class="failed-save-invoice">
        <div class="failed-save-field">
          <label>Invoice ID</label>
          <value>${escapeHtml(invoice.invoiceId || invoice.invoiceNumber)}</value>
        </div>
        <div class="failed-save-field">
          <label>Date</label>
          <value>${invoice.date}</value>
        </div>
        <div class="failed-save-field">
          <label>Parties</label>
          <value>${escapeHtml(invoice.parties)}</value>
        </div>
        <div class="failed-save-field">
          <label>Summary</label>
          <value>${escapeHtml(invoice.summary)}</value>
        </div>
      </div>
      <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem; justify-content: flex-end;">
        <button class="btn btn-delete-failed" onclick="deleteFailedSave('${entry.id}')">Discard</button>
        <button class="btn btn-retry-single" id="retry-btn-${entry.id}" onclick="retrySingleFailed('${entry.id}')">
          Retry Notion Save
        </button>
      </div>
    </div>
  `;
      }
    )
    .join("");
}

async function retrySingleFailed(id) {
  const btn = document.getElementById(`retry-btn-${id}`);
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = "Retrying...";

  try {
    const response = await fetch(`/api/failed-saves/${id}/retry`, {
      method: "POST",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Retry failed");
    }

    if (data.status === "success") {
      showMessage("✅ Invoice saved to Notion successfully!", "success");
      loadFailedSaves();
    } else {
      showMessage(`❌ Retry failed: ${data.error}`, "error");
      btn.disabled = false;
      btn.textContent = "Retry Notion Save";
    }
  } catch (error) {
    showMessage(`❌ ${error.message}`, "error");
    btn.disabled = false;
    btn.textContent = "Retry Notion Save";
  }
}

async function deleteFailedSave(id) {
  if (!confirm("Discard this failed save? The invoice data will be lost.")) return;

  try {
    const response = await fetch(`/api/failed-saves/${id}`, {
      method: "DELETE",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error);
    }

    loadFailedSaves();
  } catch (error) {
    showMessage("Failed to delete failed save", "error");
  }
}

retryAllBtn.addEventListener("click", async () => {
  if (state.isRetrying) return;

  state.isRetrying = true;
  retryAllBtn.disabled = true;
  retryAllBtn.innerHTML = `
    <svg class="spinner-small" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="currentColor" fill="none" stroke-width="3" />
    </svg>
    Retrying...
  `;

  try {
    const response = await fetch("/api/failed-saves/retry-all", {
      method: "POST",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Retry all failed");
    }

    if (data.status === "no-failed-saves") {
      showMessage("No failed saves to retry", "success");
    } else {
      const msg = `Retry complete: ${data.successCount}/${data.total} succeeded, ${data.failCount} failed`;
      if (data.failCount === 0) {
        showMessage(`✅ ${msg}`, "success");
      } else {
        showMessage(`⚠️ ${msg}`, "error");
      }
    }

    loadFailedSaves();
  } catch (error) {
    showMessage(`❌ ${error.message}`, "error");
  } finally {
    state.isRetrying = false;
    retryAllBtn.disabled = false;
    retryAllBtn.innerHTML = "Retry All";
  }
});

clearFailedBtn.addEventListener("click", async () => {
  if (!confirm("Clear ALL failed saves? This cannot be undone.")) return;

  try {
    const response = await fetch("/api/failed-saves/clear", {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Failed to clear failed saves");
    }

    showMessage("✅ All failed saves cleared", "success");
    loadFailedSaves();
  } catch (error) {
    showMessage("Failed to clear failed saves", "error");
  }
});

// Initial load
loadKeys();
loadFailedSaves();
