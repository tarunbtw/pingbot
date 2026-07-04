/* app.js — PingBot dashboard logic */

const API = "/api/urls";

// ─── DOM refs ────────────────────────────────────────────────────────────────
const form        = document.getElementById("add-form");
const urlInput     = document.getElementById("url-input");
const addBtn       = document.getElementById("add-btn");
const formError    = document.getElementById("form-error");
const listCont     = document.getElementById("list-container");
const urlCount     = document.getElementById("url-count");
const overlay      = document.getElementById("confirm-overlay");
const confirmMsg    = document.getElementById("confirm-msg");
const confirmOk     = document.getElementById("confirm-ok");
const confirmCancel = document.getElementById("confirm-cancel");

// stat cards (only present on dashboard)
const statTotal   = document.getElementById("stat-total");
const statHealthy = document.getElementById("stat-healthy");
const statIssues  = document.getElementById("stat-issues");

// ─── Confirm modal ────────────────────────────────────────────────────────────
let confirmResolve = null;

function showConfirm(msg) {
  confirmMsg.textContent = msg;
  overlay.hidden = false;
  confirmOk.focus();
  return new Promise((res) => { confirmResolve = res; });
}

confirmOk.addEventListener("click", () => {
  overlay.hidden = true;
  if (confirmResolve) confirmResolve(true);
});

confirmCancel.addEventListener("click", () => {
  overlay.hidden = true;
  if (confirmResolve) confirmResolve(false);
});

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) {
    overlay.hidden = true;
    if (confirmResolve) confirmResolve(false);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !overlay.hidden) {
    overlay.hidden = true;
    if (confirmResolve) confirmResolve(false);
  }
});

// ─── Relative time helper ─────────────────────────────────────────────────────
function timeAgo(isoString) {
  if (!isoString) return "Never pinged";
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderList(urls) {
  // Update count badge
  if (urlCount) urlCount.textContent = urls.length ? `${urls.length}` : "";

  // Update stat cards
  if (statTotal)   statTotal.textContent   = urls.length;
  if (statHealthy) statHealthy.textContent = urls.filter(u => u.last_success).length;
  if (statIssues)  statIssues.textContent  = urls.filter(u => !u.last_success || u.last_pinged_at == null).length;

  if (!urls.length) {
    listCont.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.13 5.13A10 10 0 0 0 12 22a10 10 0 0 0 6.87-16.87"/><path d="M3 3l18 18"/><path d="M8.56 2.75A10 10 0 0 1 22 16"/><circle cx="12" cy="12" r="2"/></svg></div>
        <p>No URLs yet. Add one above to get started.</p>
      </div>`;
    return;
  }

  listCont.innerHTML = "";
  urls.forEach((row) => {
    const hasLog  = row.last_pinged_at != null;
    const success = row.last_success;

    let dotClass, badgeClass, badgeLabel, statusText;
    if (!hasLog) {
      dotClass   = "pending";
      badgeClass = "pending";
      badgeLabel = "Pending";
      statusText = "Not yet pinged";
    } else if (success) {
      dotClass   = "success";
      badgeClass = "success";
      badgeLabel = `${row.last_status_code}`;
      statusText = timeAgo(row.last_pinged_at);
    } else {
      dotClass   = "fail";
      badgeClass = "fail";
      badgeLabel = `${row.last_status_code ?? "Timeout"}`;
      statusText = timeAgo(row.last_pinged_at);
    }

    const div = document.createElement("div");
    div.className = "url-row";
    div.dataset.id = row.id;
    div.innerHTML = `
      <div class="status-indicator">
        <span class="status-dot ${dotClass}" title="${badgeLabel}"></span>
      </div>
      <div class="url-info">
        <a class="url-text" href="${escHtml(row.url)}" target="_blank" rel="noopener" title="${escHtml(row.url)}">${escHtml(row.url)}</a>
        <div class="url-meta">
          <span class="url-meta-time">${statusText}</span>
          <span class="status-badge ${badgeClass}">${badgeLabel}</span>
        </div>
      </div>
      <button class="delete-btn" data-id="${row.id}" title="Remove URL" aria-label="Delete ${escHtml(row.url)}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    `;
    listCont.appendChild(div);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Load URLs ────────────────────────────────────────────────────────────────
async function loadUrls() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const data = await res.json();
    renderList(data);
  } catch (err) {
    listCont.innerHTML = `<div class="empty-state"><p style="color:var(--fail)">Failed to load URLs. ${err.message}</p></div>`;
  }
}

// ─── Add URL ──────────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";

  const url = urlInput.value.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    formError.textContent = "URL must start with http:// or https://";
    urlInput.focus();
    return;
  }

  // Loading state
  addBtn.disabled = true;
  addBtn.classList.add("loading");

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) {
      formError.textContent = data.error || "Failed to add URL.";
      return;
    }

    urlInput.value = "";
    await loadUrls();
  } catch (err) {
    formError.textContent = "Network error — please try again.";
  } finally {
    addBtn.disabled = false;
    addBtn.classList.remove("loading");
  }
});

// ─── Delete URL ───────────────────────────────────────────────────────────────
listCont.addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;

  const id  = btn.dataset.id;
  const row = btn.closest(".url-row");
  const urlText = row?.querySelector(".url-text")?.textContent || "this URL";

  const confirmed = await showConfirm(`Remove "${urlText}" from monitoring?\nThis will also delete its ping history.`);
  if (!confirmed) return;

  btn.disabled = true;

  try {
    const res = await fetch(API, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: parseInt(id, 10) }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to delete URL.");
      btn.disabled = false;
      return;
    }
    await loadUrls();
  } catch {
    alert("Network error — please try again.");
    btn.disabled = false;
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
loadUrls();
