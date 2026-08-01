import { useEffect, useState, useCallback } from 'react';
import { LogOut, Settings, Archive, Boxes, Users, Truck, Contact, MapPin, LayoutDashboard } from 'lucide-react';
import { api, getToken, clearToken } from './api/api.js';
import { mockPurchases } from './mock/mockData.js';
import logo from './assets/logo.png';
import KpiCards from './components/KpiCards.jsx';
import VendorManagementPage from './components/VendorManagementPage.jsx';
import EmployeeStatusPage from './components/EmployeeStatusPage.jsx';
import FilterBar from './components/FilterBar.jsx';
import PurchaseTable from './components/PurchaseTable.jsx';
import AddPurchaseModal from './components/AddPurchaseModal.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import NotificationSettingsModal from './components/NotificationSettingsModal.jsx';
import DeleteConfirmModal from './components/DeleteConfirmModal.jsx';
import HistoryModal from './components/HistoryModal.jsx';
import AssetLifecyclePage from './components/AssetLifecyclePage.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import { toast } from 'sonner';
import { Toaster } from './components/ui/sonner.jsx';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './components/ui/tooltip.jsx';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from './components/ui/dropdown-menu.jsx';
import { Badge } from './components/ui/badge.jsx';
import { motion } from 'motion/react';
import ManageUsersModal from './components/ManageUsersModal.jsx';
import LocationPosPage from './components/LocationPosPage.jsx';
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
        onLogout={() => {
          // Best-effort: records last_logout_at for the Employee Status
          // page (see authController.logout) — fired before the token
          // is cleared (the endpoint needs it), but never blocks
          // logging out locally even if the request fails/times out.
          api.logout().catch(() => {});
          clearToken();
          setUser(null);
        }}
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
    if (!['dashboard', 'assets', 'vendors', 'employees', 'locations'].includes(parsed?.view)) return null;
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
  const [locationsNav, setLocationsNav] = useState({ poQuery: '', token: 0 });

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
  // Toasts are now handled by sonner (see components/ui/sonner.jsx) --
  // no local state needed, sonner manages its own queue internally.

  // Same signature every call site already uses (showToast(message,
  // type)) -- only the implementation underneath changed, from a
  // single-slot { message, type } state variable rendered by the old
  // Toast.jsx, to sonner's own queued/stacked toasts.
  const showToast = useCallback((message, type = 'success') => {
    if (type === 'error') toast.error(message);
    else toast.success(message);
  }, []);

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
    // Multi-item purchases (form.items with more than one row) go
    // through the batch endpoint so every line item shares one
    // purchase_order_id; a single-item purchase keeps using the
    // original endpoint unchanged. Either way, AddPurchaseModal always
    // gets back an object with an `id` it can attach a follow-up file
    // upload to (for a batch, that's the FIRST line item created —
    // insurance/invoice files uploaded at creation time attach to that
    // one record, same as they would for a plain single-item purchase).
    let created;
    if (Array.isArray(form.items) && form.items.length > 1) {
      const result = await api.createPurchaseOrder(form); // let AddPurchaseModal show the error if this throws
      created = result.items[0];
      showToast(`Purchase created — ${result.items.length} line items added.`);
    } else {
      const item = Array.isArray(form.items) ? form.items[0] : form;
      created = await api.createPurchase({ ...form, ...item });
      showToast('Purchase created.');
    }
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

  // Admin/senior approve or reject a pending purchase (see
  // 018_asset_approval_workflow.sql / ApprovalStatusBadge.jsx). On
  // approval the backend also backfills any deferred Inventory asset
  // for an already-delivered purchase, so a full purchases reload
  // picks that up too, not just this one row's own approval_status.
  async function handleApprovePurchase(id) {
    try {
      const updated = await api.approvePurchase(id, true);
      applyPurchaseUpdate(updated);
      showToast('Purchase approved.');
      loadSummary();
    } catch (err) {
      showToast(err.message || 'Could not approve this purchase.', 'error');
    }
  }

  async function handleRejectPurchase(id, reason) {
    try {
      const updated = await api.approvePurchase(id, false, reason);
      applyPurchaseUpdate(updated);
      showToast('Purchase rejected.');
      loadSummary();
    } catch (err) {
      showToast(err.message || 'Could not reject this purchase.', 'error');
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

  async function handleCreateVendor(form) {
    const created = await api.createVendor(form);
    showToast('Vendor created.');
    loadVendorsAndLocations();
    return created;
  }

  async function handleUpdateVendor(id, form) {
    const updated = await api.updateVendor(id, form);
    showToast('Vendor updated.');
    loadVendorsAndLocations();
    return updated;
  }

  // Admin OR senior — see AuthContext.jsx's canDeleteVendor. The
  // backend also enforces this (requireAdminOrSenior on the DELETE
  // route) and returns a clear 409 if the vendor still has purchases
  // or assets referencing it, which VendorManagementPage surfaces as
  // a toast rather than a raw error.
  async function handleDeleteVendor(id) {
    try {
      await api.deleteVendor(id);
      showToast('Vendor deleted.');
      loadVendorsAndLocations();
    } catch (err) {
      showToast(err.message || 'Could not delete this vendor.', 'error');
    }
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
  function handleGoToPoNumber(poNumber) {
    setView('locations');
    setLocationsNav((n) => ({ poQuery: poNumber, token: n.token + 1 }));
  }

  return (
    <TooltipProvider delayDuration={150}>
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 shadow-sm shadow-slate-200/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-6 py-5">
          <button onClick={() => setView('dashboard')}
            title="Dashboard"
            className={`flex shrink-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors ${
              view === 'dashboard' ? 'bg-brand-50' : 'hover:bg-slate-50'
            }`}>
            <img src={logo} alt="Sangkaj Group" className="h-14 w-auto" />
            <div className="hidden sm:block">
              <h1 className="flex items-center gap-1.5 text-base font-semibold text-slate-900">
                Asset Purchase Dashboard
                {view === 'dashboard' && <LayoutDashboard size={13} className="text-brand-500" />}
              </h1>
              <p className="text-xs text-slate-500">Track spend, deliveries, and payment status across all vendors.</p>
            </div>
          </button>
          <div className="flex flex-1 justify-center">
            <GlobalSearch
              onGoToPurchase={handleGoToPurchase}
              onGoToAsset={handleGoToAsset}
              onGoToVendor={handleGoToVendor}
              onGoToPoNumber={handleGoToPoNumber}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Primary navigation -- a labeled segmented control instead
                of a bare row of icons, so destinations are readable at a
                glance (labels show at lg+, icons + tooltips cover the
                narrower breakpoints where the header was already tight). */}
            <nav className="flex items-center gap-0.5 rounded-xl bg-gradient-to-b from-slate-100 to-slate-100/70 p-1 ring-1 ring-slate-200/60">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setView(view === 'assets' ? 'dashboard' : 'assets')}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                      view === 'assets' ? 'bg-gradient-to-b from-white to-brand-50/60 text-brand-600 shadow-sm ring-1 ring-brand-100' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 hover:scale-105'
                    }`}>
                    <motion.span whileHover={{ scale: 1.2, rotate: -8 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}><Boxes size={17} strokeWidth={2.3} /></motion.span> <span className="hidden lg:inline">Assets</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Assets & Order History</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setView(view === 'vendors' ? 'dashboard' : 'vendors')}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                      view === 'vendors' ? 'bg-gradient-to-b from-white to-brand-50/60 text-brand-600 shadow-sm ring-1 ring-brand-100' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 hover:scale-105'
                    }`}>
                    <motion.span whileHover={{ scale: 1.2, rotate: -8 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}><Truck size={17} strokeWidth={2.3} /></motion.span> <span className="hidden lg:inline">Vendors</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Vendor Management</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setView(view === 'locations' ? 'dashboard' : 'locations')}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                      view === 'locations' ? 'bg-gradient-to-b from-white to-brand-50/60 text-brand-600 shadow-sm ring-1 ring-brand-100' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 hover:scale-105'
                    }`}>
                    <motion.span whileHover={{ scale: 1.2, rotate: -8 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}><MapPin size={17} strokeWidth={2.3} /></motion.span> <span className="hidden lg:inline">Locations</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Location POs</TooltipContent>
              </Tooltip>
              {isAdmin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={() => setView(view === 'employees' ? 'dashboard' : 'employees')}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                        view === 'employees' ? 'bg-gradient-to-b from-white to-brand-50/60 text-brand-600 shadow-sm ring-1 ring-brand-100' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 hover:scale-105'
                      }`}>
                      <motion.span whileHover={{ scale: 1.2, rotate: -8 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}><Contact size={17} strokeWidth={2.3} /></motion.span> <span className="hidden lg:inline">HR</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Employee Status</TooltipContent>
                </Tooltip>
              )}
            </nav>

            <div className="hidden h-6 w-px bg-slate-200 sm:block" />

            {/* Everything that isn't primary navigation -- deleted items,
                manage users, notification settings, and the account
                itself -- now lives behind one account menu instead of a
                row of separate icons. Cuts the header down to "nav pills
                + one avatar", which is the "well organised" ask: fewer
                floating icons, each action has a real label, and the
                role/name that used to just sit there as text is now part
                of a menu that actually does something. */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-all hover:scale-105 hover:bg-slate-100">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-xs font-semibold text-white shadow-sm">
                        {(user.name || '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="hidden leading-tight sm:block">
                        <span className="block text-sm font-medium text-slate-700">{user.name}</span>
                        <Badge variant={user.role === 'admin' ? 'gradient' : user.role === 'senior' ? 'coral' : 'slate'}>
                          {user.role === 'admin' ? 'Admin' : user.role === 'senior' ? 'Senior' : 'Employee'}
                        </Badge>
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Account menu</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <p className="text-sm font-medium text-slate-800">{user.name}</p>
                  <p className="text-xs font-normal text-slate-400">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowHistory(true)}>
                  <Archive size={15} className="text-slate-400" /> Deleted items
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => setShowManageUsers(true)}>
                    <Users size={15} className="text-slate-400" /> Manage users
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setShowSettings(true)}>
                  <Settings size={15} className="text-slate-400" /> Notification settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onClick={onLogout}>
                  <LogOut size={15} /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
      ) : view === 'vendors' ? (
        <VendorManagementPage
          vendors={vendors}
          onCreateVendor={handleCreateVendor}
          onUpdateVendor={handleUpdateVendor}
          onDeleteVendor={handleDeleteVendor}
        />
      ) : view === 'employees' ? (
        <EmployeeStatusPage
          onBack={() => setView('dashboard')}
          showToast={showToast}
        />
      ) : view === 'locations' ? (
        <LocationPosPage
          key={locationsNav.token}
          initialPoQuery={locationsNav.poQuery}
          onBack={() => setView('dashboard')}
          showToast={showToast}
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
            onApprovePurchase={handleApprovePurchase}
            onRejectPurchase={handleRejectPurchase}
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

      <Toaster />
    </div>
    </TooltipProvider>
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
    total_value: data.reduce((s, p) => s + (p.total_cost_with_tax ?? p.total_cost), 0),
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
