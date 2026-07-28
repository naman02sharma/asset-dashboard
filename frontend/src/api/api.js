// Thin fetch wrapper around the backend REST API. Centralizing this
// means swapping the base URL, or how the auth token is attached,
// only happens here.
const BASE_URL = '/api';
const TOKEN_KEY = 'asset_dashboard_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Multipart uploads must NOT set a JSON Content-Type — the browser
// needs to set its own `multipart/form-data; boundary=...` header, so
// this deliberately skips the header the plain request() helper adds.
// Accepts MULTIPLE files under the same field name — matches the
// backend's multer .array(fieldName, 10) on the receiving end.
//
// Built on XMLHttpRequest (rather than fetch) specifically so callers
// can pass an onProgress(percent) callback and drive a real upload
// progress bar — fetch has no upload-progress event, XHR does.
function uploadFiles(path, fieldName, files, onProgress) {
  const token = getToken();
  const formData = new FormData();
  for (const file of files) formData.append(fieldName, file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }

    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        // Shape: { purchase, results: [{ name, success, error? }, ...] } —
        // callers surface per-file failures without losing the successes.
        resolve(body);
      } else {
        reject(new Error(body.error || `Upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed: network error.'));
    xhr.send(formData);
  });
}

// Triggers a browser download for an authenticated GET endpoint (CSV
// exports). A plain <a href="/api/..."> can't include the
// Authorization header, so this fetches the file as a blob first, then
// hands the browser a temporary object URL to download from — the
// filename comes from the backend's Content-Disposition header
// (utils/csv.js -> sendCsv) rather than being guessed client-side.
async function downloadFile(path) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Export failed: ${res.status}`);
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
  const filename = filenameMatch ? filenameMatch[1] : 'export.csv';

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Fetches a binary response (e.g. the QR code PNG) as a Blob rather
// than triggering a download — used to build an <img> object URL,
// since a plain <img src="..."> can't send the Authorization header
// this endpoint requires.
async function fetchBlob(path) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.blob();
}

export const api = {
  // --- Auth ---
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, newPassword) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),
  listUsers: () => request('/auth/users'),
  updateUserRole: (id, role) => request(`/auth/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  updateUserApproval: (id, is_approved) => request(`/auth/users/${id}/approval`, { method: 'PATCH', body: JSON.stringify({ is_approved }) }),
  deleteUser: (id) => request(`/auth/users/${id}`, { method: 'DELETE' }),
  getMe: () => request('/auth/me'),
  updateNotificationSettings: (data) =>
    request('/auth/notification-settings', { method: 'PATCH', body: JSON.stringify(data) }),

  // --- Purchases (dashboard) ---
  getSummary: () => request('/purchases/summary'),
  getSpendTrend: (months = 6) => request(`/purchases/spend-trend?months=${months}`),
  getPurchasesByMonth: (month) => request(`/purchases/by-month?month=${month}`),

  getPurchases: ({ q, status, sortBy, sortDir } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (sortBy) params.set('sortBy', sortBy);
    if (sortDir) params.set('sortDir', sortDir);
    return request(`/purchases?${params.toString()}`);
  },

  getHistory: () => request('/purchases/history'),

  // --- Successful Order History (delivered, non-archived) ---
  getCompleted: ({ q, vendor, dateFrom, dateTo, page, pageSize } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (vendor) params.set('vendor', vendor);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (page) params.set('page', page);
    if (pageSize) params.set('pageSize', pageSize);
    return request(`/purchases/completed?${params.toString()}`);
  },

  createPurchase: (data) => request('/purchases', { method: 'POST', body: JSON.stringify(data) }),

  // Admin-only general edit — any of a purchase's own fields (item
  // name, vendor, quantity, unit cost, dates, PO number, etc). Separate
  // from updateStatus/updateAdvancePayment/updateInsurance below, which
  // each keep their own narrower endpoint.
  updatePurchase: (id, data) => request(`/purchases/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  updateStatus: (id, status) =>
    request(`/purchases/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  recordDelivery: (id, data) =>
    request(`/purchases/${id}/record-delivery`, { method: 'PATCH', body: JSON.stringify(data) }),

  updateDeliveryDate: (id, expected_delivery_date) =>
    request(`/purchases/${id}/delivery-date`, {
      method: 'PATCH',
      body: JSON.stringify({ expected_delivery_date }),
    }),

  recordPayment: (id, payment) =>
    request(`/purchases/${id}/payments`, { method: 'POST', body: JSON.stringify(payment) }),

  // The dashboard's "Modify" toggle — sets Advance Money Paid to a new
  // TOTAL (not "add this much"); amount_remaining recalculates
  // automatically server-side.
  updateAdvancePayment: (id, amount_paid) =>
    request(`/purchases/${id}/advance-payment`, { method: 'PATCH', body: JSON.stringify({ amount_paid }) }),

  // mode: 'history' (default, recoverable for 3 months) | 'permanent'
  deletePurchase: (id, mode = 'history') =>
    request(`/purchases/${id}?mode=${mode}`, { method: 'DELETE' }),

  restorePurchase: (id) => request(`/purchases/${id}/restore`, { method: 'PATCH' }),

  updateInsurance: (id, insurance_done) =>
    request(`/purchases/${id}/insurance`, { method: 'PATCH', body: JSON.stringify({ insurance_done }) }),

  uploadInsurancePhotos: (id, files, onProgress) => uploadFiles(`/purchases/${id}/insurance-photos`, 'photos', files, onProgress),
  uploadInvoices: (id, files, onProgress) => uploadFiles(`/purchases/${id}/invoices`, 'invoices', files, onProgress),
  deleteFile: (purchaseId, fileId) => request(`/purchases/${purchaseId}/files/${fileId}`, { method: 'DELETE' }),

  // --- Maintenance (scheduled from Completed Orders, alerted + completed from the dashboard) ---
  scheduleMaintenance: (id, data) =>
    request(`/purchases/${id}/maintenance`, { method: 'PATCH', body: JSON.stringify(data) }),
  completeMaintenance: (id) =>
    request(`/purchases/${id}/maintenance/complete`, { method: 'PATCH' }),

  // Full History timeline for one purchase: status changes, payments,
  // and Advance-Payment "Modify" edits — see purchaseController.getPurchaseAudit.
  getPurchaseAudit: (id) => request(`/purchases/${id}/audit`),

  // --- CSV exports ---
  exportPurchases: ({ q, status, sortBy, sortDir } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (sortBy) params.set('sortBy', sortBy);
    if (sortDir) params.set('sortDir', sortDir);
    return downloadFile(`/purchases/export?${params.toString()}`);
  },
  exportCompleted: ({ q, vendor, dateFrom, dateTo } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (vendor) params.set('vendor', vendor);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    return downloadFile(`/purchases/completed/export?${params.toString()}`);
  },
  exportAssets: ({ q, status } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    return downloadFile(`/assets/export?${params.toString()}`);
  },
  importAssets: (csvText) => request('/assets/import', { method: 'POST', body: JSON.stringify({ csv: csvText }) }),

  getVendors: () => request('/vendors'),
  createVendor: (data) => request('/vendors', { method: 'POST', body: JSON.stringify(data) }),
  updateVendor: (id, data) => request(`/vendors/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getLocations: () => request('/locations'),

  // --- Inventory & Asset Assignment module ---
  getAssetSummary: () => request('/assets/summary'),
  getAssetQrCode: (id) => fetchBlob(`/assets/${id}/qrcode`),

  getAssets: ({ q, status, sortBy, sortDir } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (sortBy) params.set('sortBy', sortBy);
    if (sortDir) params.set('sortDir', sortDir);
    return request(`/assets?${params.toString()}`);
  },

  getAssetDetail: (id) => request(`/assets/${id}`),
  createAsset: (data) => request('/assets', { method: 'POST', body: JSON.stringify(data) }),
  updateAsset: (id, data) => request(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAsset: (id) => request(`/assets/${id}`, { method: 'DELETE' }),

  assignAsset: (id, data) => request(`/assets/${id}/assign`, { method: 'POST', body: JSON.stringify(data) }),
  dispatchAssetToMaintenance: (id, data) =>
    request(`/assets/${id}/dispatch-repair`, { method: 'POST', body: JSON.stringify(data) }),
  returnAsset: (id, data) => request(`/assets/${id}/return`, { method: 'PATCH', body: JSON.stringify(data) }),
  setAssetStatus: (id, status) => request(`/assets/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  uploadAmcContracts: (id, files, onProgress) => uploadFiles(`/assets/${id}/amc-contracts`, 'files', files, onProgress),
  uploadAmcInvoices: (id, files, onProgress) => uploadFiles(`/assets/${id}/amc-invoices`, 'files', files, onProgress),
  deleteAssetFile: (assetId, fileId) => request(`/assets/${assetId}/files/${fileId}`, { method: 'DELETE' }),

  getCalendarEvents: () => request('/assets/calendar'),

  getEmployees: (activeOnly = true) => request(`/employees?activeOnly=${activeOnly}`),
};
