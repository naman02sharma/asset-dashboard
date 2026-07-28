import { useEffect, useState, useCallback } from 'react';
import { LogOut, Settings, Archive, Boxes, Users } from 'lucide-react';
import { api, getToken, clearToken } from './api/api.js';
import { mockPurchases } from './mock/mockData.js';
import logo from './assets/logo.png';
import KpiCards from './components/KpiCards.jsx';
import FilterBar from './components/FilterBar.jsx';
import PurchaseTable from './components/PurchaseTable.jsx';
import AddPurchaseModal from './components/AddPurchaseModal.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import NotificationSettingsModal from './components/NotificationSettingsModal.jsx';
import DeleteConfirmModal from './components/DeleteConfirmModal.jsx';
import HistoryModal from './components/HistoryModal.jsx';
import AssetLifecyclePage from './components/AssetLifecyclePage.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import Toast from './components/Toast.jsx';
import ManageUsersModal from './components/ManageUsersModal.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';

export default function App() {
  // --- Auth state ---
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Restore session from a stored token on first load.
  useEffect(() => {
    async function restoreSession() {
      if (!getToken()) { setAuthChecked(true); return; }
      try {
        setUser(await api.getMe());
      } catch {
        clearToken(); // token expired/invalid
      } finally {
        setAuthChecked(true);
      }
    }
    restoreSession();
  }, []);

  if (!authChecked) return null; // avoid a login-screen flash while checking

  if (!user) {
    return <LoginScreen onAuthenticated={setUser} />;
  }

  return (
    <AuthProvider user={user}>
      <Dashboard
        user={user}
        onLogout={() => { clearToken(); setUser(null); }}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        onSettingsSaved={(updated) => setUser((u) => ({ ...u, ...updated }))}
      />
    </AuthProvider>
  );
}

// Persists which page (and, within Assets, which tab) the person was
// on so a browser reload lands back where they were instead of
// snapping to the Home Dashboard — plain React state alone doesn't
// survive a reload, so this is the one thing here that needs to.
const VIEW_STORAGE_KEY = 'asset_dashboard_view_state';

function loadStoredViewState() {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.view !== 'dashboard' && parsed?.view !== 'assets') return null;
    return parsed;
  } catch {
    return null; // corrupt/foreign value — fall back to defaults below
  }
}

function Dashboard({ user, onLogout, showSettings, setShowSettings, onSettingsSaved }) {
  const { isAdmin } = useAuth();
  const [showManageUsers, setShowManageUsers] = useState(false);
  const storedViewState = loadStoredViewState();
  // 'dashboard' = active purchases + maintenance alerts (Home Dashboard)
  // 'assets' = combined Successful Order History + Inventory Management
  //            (tabs within AssetLifecyclePage — delivered purchases
  //            auto-flow into Inventory, see trackingService.js)
  const [view, setView] = useState(storedViewState?.view || 'dashboard');

  // Navigating here from GlobalSearch needs to force a fresh mount of
  // AssetLifecyclePage (and reseed its tab/query) even if it's already
  // open on a different tab — the `token` bump gives it a changing
  // `key` for exactly that.
  const [assetsNav, setAssetsNav] = useState({ tab: storedViewState?.assetsTab || 'history', query: '', token: 0 });

  // Keep the stored state in sync with whatever's on screen — cheap
  // enough to just re-write on every change rather than debouncing.
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ view, assetsTab: assetsNav.tab }));
    } catch {
      /* localStorage unavailable (private browsing, quota) — not worth surfacing to the user */
    }
  }, [view, assetsNav.tab]);

  const [purchases, setPurchases] = useState([]);
  const [summary, setSummary] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingMockData, setUsingMockData] = useState(false);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('expected_delivery_date:asc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // purchase pending delete confirmation
  const [toast, setToast] = useState(null); // { message, type }

  const showToast = useCallback((message, type = 'success') => setToast({ message, type }), []);

  // Debounce the search box so we're not firing a request per keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  async function loadPurchases() {
    setLoading(true);
    const [sortBy, sortDir] = sort.split(':');
    try {
      const data = await api.getPurchases({ q: debouncedQuery, status, sortBy, sortDir });
      setPurchases(data);
      setUsingMockData(false);
    } catch (err) {
      // Backend/database not reachable — fall back to mock data,
      // filtered/sorted client-side, so the UI is still browsable.
      console.warn('API unavailable, using mock data:', err.message);
      setPurchases(filterAndSortMock(mockPurchases, debouncedQuery, status, sortBy, sortDir));
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  }

  async function loadSummary() {
    try {
      setSummary(await api.getSummary());
    } catch {
      setSummary(computeMockSummary(mockPurchases));
    }
  }

  async function loadVendorsAndLocations() {
    api.getVendors().then(setVendors).catch(() => setVendors([]));
    api.getLocations().then(setLocations).catch(() => setLocations([]));
  }

  useEffect(() => { loadSummary(); loadVendorsAndLocations(); }, []);
  useEffect(() => { if (view === 'dashboard') loadPurchases(); }, [debouncedQuery, status, sort, view]);

  async function handleCreatePurchase(form) {
    const created = await api.createPurchase(form); // let AddPurchaseModal show the error if this throws
    showToast('Purchase created.');
    loadPurchases();
    loadSummary();
    loadVendorsAndLocations(); // pick up any newly created vendor/location for future autocomplete
    return created; // AddPurchaseModal needs the id for a follow-up file upload
  }

  // Used by AddPurchaseModal for the optional insurance/invoice files
  // picked at creation time — a single combined call so the modal only
  // needs one handler regardless of which file groups were filled in.
  async function handleUploadFilesAtCreation(purchaseId, photoFiles, invoiceFiles) {
    const failures = [];
    if (photoFiles.length) {
      const res = await api.uploadInsurancePhotos(purchaseId, photoFiles).catch((err) => { failures.push(err.message); return null; });
      if (res) applyPurchaseUpdate(res.purchase);
    }
    if (invoiceFiles.length) {
      const res = await api.uploadInvoices(purchaseId, invoiceFiles).catch((err) => { failures.push(err.message); return null; });
      if (res) applyPurchaseUpdate(res.purchase);
    }
    if (failures.length) {
      showToast(`Purchase saved, but some files failed to upload: ${failures.join('; ')}`, 'error');
    } else {
      showToast('Files uploaded.');
    }
    loadPurchases();
  }

  // Replaces one row in local state with a fresh copy from the server —
  // the single place every mutation handler below converges on, so
  // there's one code path for "apply the server's version of this row"
  // rather than each handler hand-rolling its own merge.
  function applyPurchaseUpdate(updatedPurchase) {
    if (!updatedPurchase) return;
    setPurchases((rows) => rows.map((p) => (p.id === updatedPurchase.id ? updatedPurchase : p)));
  }

  // Optimistically updates the row locally, then confirms against the
  // API — so the dropdown feels instant instead of waiting on a full
  // table refetch.
  async function handleStatusChange(id, newStatus) {
    const previous = purchases;
    setPurchases((rows) => rows.map((p) => (p.id === id ? { ...p, order_status: newStatus } : p)));
    try {
      const updated = await api.updateStatus(id, newStatus);
      // If the new status is "delivered" (and it's not a maintenance
      // alert re-surfacing it), the row now belongs on Successful Order
      // History, not here — drop it from the dashboard list instead of
      // showing a stale "delivered" row until the next full refetch.
      if (updated.order_status === 'delivered' && !updated.is_maintenance_due) {
        setPurchases((rows) => rows.filter((p) => p.id !== id));
      } else {
        applyPurchaseUpdate(updated);
      }
      loadSummary(); // pending-deliveries count may have changed
    } catch (err) {
      console.warn('Could not update status:', err.message);
      setPurchases(previous); // revert on failure
      showToast(err.message || 'Could not update status.', 'error');
    }
  }

  async function handleModifyAdvancePayment(id, amountPaid) {
    const updated = await api.updateAdvancePayment(id, amountPaid); // AdvancePaymentEditor shows its own error on throw
    applyPurchaseUpdate(updated); // no-op if this purchase isn't in the dashboard's own list (e.g. already delivered) — harmless
    loadSummary(); // total paid/remaining KPI cards need to reflect the edit
    return updated;
  }

  // Admin-only general edit (EditPurchaseModal) — item name, vendor,
  // quantity, unit cost, dates, PO number, etc. Refreshes vendors/
  // locations too since editing can create a new one (same as
  // handleCreatePurchase), and total_cost is a generated column so KPI
  // cards can change even without touching amount_paid directly.
  async function handleUpdatePurchase(id, form) {
    const updated = await api.updatePurchase(id, form); // EditPurchaseModal shows its own error on throw
    applyPurchaseUpdate(updated);
    loadSummary();
    loadVendorsAndLocations();
    return updated;
  }

  async function handleRecordDelivery(id, data) {
    const updated = await api.recordDelivery(id, data); // RecordDeliveryModal shows its own error on throw
    if (updated.order_status === 'delivered') {
      // Fully delivered now — this purchase moves out of the active
      // dashboard list entirely (same as any other delivered order).
      setPurchases((rows) => rows.filter((p) => p.id !== id));
    } else {
      applyPurchaseUpdate(updated);
    }
    loadSummary();
    return updated;
  }

  async function handleInsuranceToggle(id, done) {
    const previous = purchases;
    setPurchases((rows) => rows.map((p) => (p.id === id ? { ...p, insurance_done: done } : p)));
    try {
      const updated = await api.updateInsurance(id, done);
      applyPurchaseUpdate(updated);
    } catch (err) {
      setPurchases(previous);
      showToast(err.message, 'error');
    }
  }

  async function handleUploadPhotos(id, files, onProgress) {
    try {
      const result = await api.uploadInsurancePhotos(id, files, onProgress);
      applyPurchaseUpdate(result.purchase);
      const failed = result.results.filter((r) => !r.success);
      if (failed.length) showToast(`${failed.length} photo(s) failed to upload.`, 'error');
      return result;
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  }

  async function handleUploadInvoices(id, files, onProgress) {
    try {
      const result = await api.uploadInvoices(id, files, onProgress);
      applyPurchaseUpdate(result.purchase);
      const failed = result.results.filter((r) => !r.success);
      if (failed.length) showToast(`${failed.length} file(s) failed to upload.`, 'error');
      return result;
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  }

  async function handleDeleteFile(purchaseId, fileId) {
    const updated = await api.deleteFile(purchaseId, fileId); // FilesCell shows its own error on throw
    applyPurchaseUpdate(updated);
  }

  async function handleCompleteMaintenance(id) {
    try {
      await api.completeMaintenance(id);
      // Whether it was recurring (rescheduled) or one-off (cleared),
      // this row no longer belongs on the dashboard — it's either back
      // to a plain delivered purchase or has a future (not-yet-due)
      // maintenance date. Either way, drop it here; Successful Order
      // History picks it up on its own next load.
      setPurchases((rows) => rows.filter((p) => p.id !== id));
      loadSummary();
      showToast('Maintenance marked complete.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleConfirmDelete(mode) {
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await api.deletePurchase(target.id, mode);
      setPurchases((rows) => rows.filter((p) => p.id !== target.id));
      loadSummary();
      showToast(mode === 'permanent' ? 'Purchase permanently deleted.' : 'Moved to Deleted Items.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- GlobalSearch navigation: jump to the right view/tab and seed
  // that page's own search box with the picked name. ---
  function handleGoToPurchase(itemName) {
    setView('dashboard');
    setQuery(itemName);
  }
  function handleGoToAsset(assetName) {
    setView('assets');
    setAssetsNav((n) => ({ tab: 'inventory', query: assetName, token: n.token + 1 }));
  }
  function handleGoToVendor(vendorName) {
    // A vendor could show up on either side — Order History is the
    // more natural landing spot since spend/vendor questions are
    // usually about what's already been bought from them.
    setView('assets');
    setAssetsNav((n) => ({ tab: 'history', query: vendorName, token: n.token + 1 }));
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-6 py-5">
          <button onClick={() => setView('dashboard')} className="flex shrink-0 items-center gap-3 text-left">
            <img src={logo} alt="Sangkaj Group" className="h-14 w-auto" />
            <div className="hidden sm:block">
              <h1 className="text-base font-semibold text-slate-900">Asset Purchase Dashboard</h1>
              <p className="text-xs text-slate-500">Track spend, deliveries, and payment status across all vendors.</p>
            </div>
          </button>
          <div className="flex flex-1 justify-center">
            <GlobalSearch
              onGoToPurchase={handleGoToPurchase}
              onGoToAsset={handleGoToAsset}
              onGoToVendor={handleGoToVendor}
            />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden items-center gap-1.5 sm:flex">
              <span className="text-sm text-slate-500">{user.name}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${isAdmin ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                {isAdmin ? 'Admin' : 'Employee'}
              </span>
            </div>
            <button onClick={() => setView(view === 'assets' ? 'dashboard' : 'assets')}
              title="Assets & Order History"
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                view === 'assets' ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}>
              <Boxes size={16} />
            </button>
            <button onClick={() => setShowHistory(true)}
              title="Deleted items"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
              <Archive size={16} />
            </button>
            {isAdmin && (
              <button onClick={() => setShowManageUsers(true)}
                title="Manage users"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                <Users size={16} />
              </button>
            )}
            <button onClick={() => setShowSettings(true)}
              title="Notification settings"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
              <Settings size={16} />
            </button>
            <button onClick={onLogout}
              title="Log out"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {view === 'assets' ? (
        <AssetLifecyclePage
          key={assetsNav.token}
          vendors={vendors}
          locations={locations}
          onBack={() => setView('dashboard')}
          showToast={showToast}
          initialTab={assetsNav.tab}
          initialQuery={assetsNav.query}
          onModifyAdvancePayment={handleModifyAdvancePayment}
          onRecordDelivery={handleRecordDelivery}
          onEditPurchase={handleUpdatePurchase}
          onSummaryChange={loadSummary}
        />
      ) : (
        <main className="mx-auto max-w-[1600px] space-y-6 px-6 py-6">
          {usingMockData && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
              Showing sample data — connect the backend API to see live purchases.
            </div>
          )}

          <KpiCards summary={summary} />

          <FilterBar
            query={query} setQuery={setQuery}
            status={status} setStatus={setStatus}
            sort={sort} setSort={setSort}
            onAddClick={() => setShowAddModal(true)}
            onExport={async () => {
              const [sortBy, sortDir] = sort.split(':');
              try {
                await api.exportPurchases({ q: debouncedQuery, status, sortBy, sortDir });
              } catch (err) {
                showToast(err.message, 'error');
              }
            }}
          />

          <PurchaseTable
            purchases={purchases}
            sort={sort}
            onSortChange={setSort}
            loading={loading}
            vendors={vendors}
            locations={locations}
            onStatusChange={handleStatusChange}
            onDeleteClick={setDeleteTarget}
            onInsuranceToggle={handleInsuranceToggle}
            onUploadPhotos={handleUploadPhotos}
            onUploadInvoices={handleUploadInvoices}
            onDeleteFile={handleDeleteFile}
            onModifyAdvancePayment={handleModifyAdvancePayment}
            onCompleteMaintenance={handleCompleteMaintenance}
            onRecordDelivery={handleRecordDelivery}
            onEditPurchase={handleUpdatePurchase}
          />
        </main>
      )}

      {showAddModal && (
        <AddPurchaseModal
          vendors={vendors}
          locations={locations}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleCreatePurchase}
          onUploadFiles={handleUploadFilesAtCreation}
        />
      )}

      {showSettings && (
        <NotificationSettingsModal
          user={user}
          onClose={() => setShowSettings(false)}
          onSaved={onSettingsSaved}
        />
      )}

      {showManageUsers && (
        <ManageUsersModal onClose={() => setShowManageUsers(false)} showToast={showToast} />
      )}

      {showHistory && (
        <HistoryModal
          onClose={() => setShowHistory(false)}
          onChanged={(message, type) => { showToast(message, type); loadSummary(); }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          purchase={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// --- Client-side fallback helpers (only used when the API is unreachable) ---

function filterAndSortMock(data, q, status, sortBy, sortDir) {
  let rows = [...data];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((p) => p.item_name.toLowerCase().includes(needle) || p.vendor_name.toLowerCase().includes(needle));
  }
  if (status) rows = rows.filter((p) => p.order_status === status);
  rows.sort((a, b) => {
    const dir = sortDir === 'desc' ? -1 : 1;
    if (a[sortBy] < b[sortBy]) return -1 * dir;
    if (a[sortBy] > b[sortBy]) return 1 * dir;
    return 0;
  });
  return rows;
}

function computeMockSummary(data) {
  const pending = data.filter((p) => !['delivered', 'cancelled'].includes(p.order_status));
  return {
    total_value: data.reduce((s, p) => s + p.total_cost, 0),
    total_paid: data.reduce((s, p) => s + p.amount_paid, 0),
    total_remaining: data.reduce((s, p) => s + p.amount_remaining, 0),
    pending_deliveries: pending.length,
    pending_delivery_amount_remaining: pending.reduce((s, p) => s + p.amount_remaining, 0),
    // Mock data has no maintenance fields — both default to 0, same as
    // a fresh install would show before anything's scheduled.
    upcoming_maintenance_cost: 0,
    upcoming_maintenance_count: 0,
  };
}
