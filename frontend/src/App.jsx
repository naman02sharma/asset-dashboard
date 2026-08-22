import { useEffect, useRef, useState, useCallback } from 'react';
import { LogOut, Settings, Archive, Users, Truck, Contact, MapPin, LayoutDashboard, ShoppingCart, PackageCheck } from 'lucide-react';
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
import InventoryPage from './components/InventoryPage.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import CombinedCalendar from './components/CombinedCalendar.jsx';
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

function Dashboard({ user, onLogout, showSettings, setShowSettings, onSettingsSaved }) {
  const { isAdmin } = useAuth();
  const [showManageUsers, setShowManageUsers] = useState(false);
  // 'dashboard' = Inventory Management (Home) — hardware, AMC contracts,
  //               and employee assignment lifecycles
  // 'purchases' = active purchases + maintenance alerts (Purchase Orders)
  // 'assets'    = Successful Order History (delivered purchases
  //               auto-flow into Inventory on the Home page, see
  //               trackingService.js)
  // 'calendar'  = full-page month calendar — opened in a NEW TAB via
  //               window.open('/?view=calendar', '_blank') from
  //               CombinedCalendarCard's "Full calendar" link (was a
  //               centered modal before; a real tab lets the person
  //               keep both the calendar and whatever they were doing
  //               open side by side instead of losing their place).
  //
  // A brand-new arrival at the site (login, a fresh tab/window) lands
  // on Inventory Management ('dashboard') — but reloading the SAME tab
  // (F5 / Ctrl+R) should keep you exactly where you were instead of
  // bouncing back to Inventory Management. sessionStorage is what
  // makes that distinction for free: it survives a reload of the same
  // tab, but a new tab (or a new login) starts with none, so it still
  // falls through to the 'dashboard' default exactly as before. The
  // calendar deep link stays a special case — it's opened as its own
  // dedicated tab via window.open('/?view=calendar', '_blank'), never
  // something a reload should try to restore into a different tab.
  const VIEW_STORAGE_KEY = 'asset_dashboard_last_view';
  const [view, setView] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('view') === 'calendar') return 'calendar';
      const stored = sessionStorage.getItem(VIEW_STORAGE_KEY);
      if (stored) return stored;
    } catch { /* URL/sessionStorage unavailable — fall through to the default */ }
    return 'dashboard';
  });

  // Keep sessionStorage in sync so a same-tab reload restores this
  // view. The calendar tab is deliberately excluded — it's already
  // reached only via its own URL param, and persisting it here would
  // make an ordinary reload of the MAIN tab jump to the calendar if
  // the person had ever opened it in this session.
  useEffect(() => {
    try {
      if (view === 'calendar') return;
      sessionStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch { /* sessionStorage unavailable — nothing to persist to */ }
  }, [view]);

  // Navigating here from GlobalSearch needs to force a fresh mount of
  // the destination page (and reseed its query) even if it's already
  // open — the `token` bump gives it a changing `key` for exactly that.
  const [historyNav, setHistoryNav] = useState({ query: '', token: 0 });
  const [inventoryNav, setInventoryNav] = useState({ query: '', token: 0 });
  // Set by handleGoToInventoryAsset (below) when the click originates
  // from a location page rather than the global search bar — see that
  // function for why this is a highlight, not a search filter.
  const [inventoryHighlight, setInventoryHighlight] = useState({ assetId: null, purchaseId: null, token: 0 });
  const [locationsNav, setLocationsNav] = useState({ poQuery: '', token: 0 });
  // Every other tab (Order History, Home/Inventory, Locations) is its
  // own child component that mounts fresh — with its own `useEffect(
  // () => { load() }, [])` — every time you switch to it, so arriving
  // there always shows current data with no manual reload needed. The
  // Purchases tab used to be the one exception: its markup lived
  // directly inside Dashboard, which never unmounts, so it depended
  // entirely on the query/status/sort/view effect below noticing a
  // change — and switching straight back to a tab whose dependencies
  // hadn't changed (or a race between two fetches) could leave it
  // showing stale/empty data until an actual browser refresh. This
  // token bumps every time we navigate TO Purchases (nav button or
  // GlobalSearch) and is used as that panel's `key`, forcing the same
  // guaranteed fresh-mount fetch the other tabs already get.
  const [purchasesNav, setPurchasesNav] = useState(0);

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

  // A ref-based request counter, not a boolean "loading" flag — this
  // guards against an OUT-OF-ORDER response, not a simultaneous one.
  // Every card on the Purchases/Order-History/Inventory pages calls
  // loadSummary() after its own mutation (record a payment, delete an
  // asset, record a delivery, ...). If two of those fire close
  // together and the FIRST request happens to resolve AFTER the
  // SECOND (a slow network hiccup, a busier query, whatever), the
  // stale first response would land last and silently overwrite the
  // fresh numbers — which looks exactly like "the KPI cards don't
  // update until I hit refresh", because a refresh is a single clean
  // request with nothing to race against. Only the response matching
  // the most recently *issued* request is ever applied.
  const summaryRequestId = useRef(0);
  async function loadSummary() {
    const requestId = ++summaryRequestId.current;
    try {
      const data = await api.getSummary();
      if (requestId === summaryRequestId.current) setSummary(data);
    } catch {
      if (requestId === summaryRequestId.current) setSummary(computeMockSummary(mockPurchases));
    }
  }

  async function loadVendorsAndLocations() {
    api.getVendors().then(setVendors).catch(() => setVendors([]));
    api.getLocations().then(setLocations).catch(() => setLocations([]));
  }

  useEffect(() => { loadSummary(); loadVendorsAndLocations(); }, []);
  useEffect(() => { if (view === 'purchases') loadPurchases(); }, [debouncedQuery, status, sort, view]);
  // Belt-and-suspenders alongside every loadSummary() call already
  // sprinkled after individual mutations (record a payment, delete an
  // asset, record a delivery, edit a purchase, ...): landing ON the
  // Purchases page — where the KPI cards actually live — always
  // fetches a fresh summary, so even a change made from some other
  // path this file's authors didn't think to wire up still shows
  // correctly the moment you arrive here, without needing a manual
  // browser refresh.
  useEffect(() => { if (view === 'purchases') loadSummary(); }, [view]);
  // Covers the case the effect above can't: coming BACK to this
  // browser tab (or this tab regaining focus after another window was
  // in front) while already sitting on the Purchases view. `view`
  // itself never changes in that scenario, so nothing above would
  // re-fire — without this, a purchase edited from a second tab/window
  // wouldn't show up here until an actual page reload.
  useEffect(() => {
    function handleVisibilityOrFocus() {
      if (document.visibilityState === 'visible' && view === 'purchases') {
        loadSummary();
        loadPurchases();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [view, debouncedQuery, status, sort]);

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
      return updated;
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
    return updated;
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

  // --- GlobalSearch navigation: jump to the right view and seed
  // that page's own search box with the picked name. ---
  function handleGoToPurchase(itemName) {
    setView('purchases');
    setQuery(itemName);
    goToPurchases();
  }

  // Single source of truth for "arriving at Purchases": bumps the
  // remount key (belt-and-suspenders for the effects below) AND fires
  // the fetches directly, right here, in the click handler itself.
  // The remount-triggered effects in PurchasesPanel/Dashboard are not
  // reliable enough to depend on alone — they can lose a race against
  // an in-flight fetch from the tab you're leaving, or simply not fire
  // if `view` was already 'purchases' (e.g. this click follows one
  // that got swallowed). Calling loadPurchases()/loadSummary()
  // directly here removes any dependency on effect ordering entirely:
  // the moment the click happens, a fresh request goes out.
  function goToPurchases() {
    setPurchasesNav((n) => n + 1);
    loadPurchases();
    loadSummary();
  }
  function handleGoToAsset(assetName) {
    // Inventory Management now lives on the Home page.
    setView('dashboard');
    setInventoryNav((n) => ({ query: assetName, token: n.token + 1 }));
  }
  /**
   * Used by the Location pages (LocationPosPage, LocationAssetsModal)
   * instead of handleGoToAsset above — that one searches by NAME,
   * which filters the Inventory list down to matches and hides every
   * other asset until the search is cleared (the "all other assets
   * disappear" bug). This jumps to Inventory with NO filter applied —
   * the full list stays visible — and instead briefly highlights
   * something for 2 seconds so it's easy to spot, then fades back to
   * normal:
   *  - clicking one standalone asset highlights just that row
   *    (asset.id)
   *  - clicking a bulk/partial-delivery batch's header (asset.isBatch)
   *    highlights every unit in that whole batch instead, and expands
   *    the batch if it was collapsed so the highlighted rows are
   *    actually visible.
   */
  function handleGoToInventoryAsset(asset) {
    setView('dashboard');
    if (asset.isBatch) {
      setInventoryHighlight({ assetId: null, purchaseId: asset.purchase_id, token: Date.now() });
    } else {
      setInventoryHighlight({ assetId: asset.id, purchaseId: null, token: Date.now() });
    }
  }
  function handleGoToVendor(vendorName) {
    // A vendor could show up on either side — Order History is the
    // more natural landing spot since spend/vendor questions are
    // usually about what's already been bought from them.
    setView('assets');
    setHistoryNav((n) => ({ query: vendorName, token: n.token + 1 }));
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
            title="Home — Inventory Management"
            className={`flex shrink-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors ${
              view === 'dashboard' ? 'bg-brand-50' : 'hover:bg-slate-50'
            }`}>
            <img src={logo} alt="Sangkaj Group" className="h-14 w-auto" />
            <div className="hidden sm:block">
              <h1 className="flex items-center gap-1.5 text-base font-semibold text-slate-900">
                Asset Purchase Dashboard
                {view === 'dashboard' && <LayoutDashboard size={13} className="text-brand-500" />}
              </h1>
              <p className="text-xs text-slate-500">Hardware, AMC contracts, and employee assignment lifecycles.</p>
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
                  <button onClick={() => {
                      const goingTo = view === 'purchases' ? 'dashboard' : 'purchases';
                      if (goingTo === 'purchases') {
                        // A real, full page reload — not just a React
                        // state/remount trick — so the KPI cards and
                        // table are guaranteed fresh no matter what SPA
                        // state was doing. VIEW_STORAGE_KEY already
                        // persists across a same-tab reload (see the
                        // useState initializer above), so writing it
                        // here first means the reloaded page lands
                        // right back on Purchases automatically.
                        try { sessionStorage.setItem(VIEW_STORAGE_KEY, 'purchases'); } catch { /* ignore */ }
                        window.location.reload();
                        return;
                      }
                      setView(goingTo);
                    }}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                      view === 'purchases' ? 'bg-gradient-to-b from-white to-brand-50/60 text-brand-600 shadow-sm ring-1 ring-brand-100' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 hover:scale-105'
                    }`}>
                    <motion.span whileHover={{ scale: 1.2, rotate: -8 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}><ShoppingCart size={17} strokeWidth={2.3} /></motion.span> <span className="hidden lg:inline">Purchases</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Purchase Orders</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setView(view === 'assets' ? 'dashboard' : 'assets')}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                      view === 'assets' ? 'bg-gradient-to-b from-white to-brand-50/60 text-brand-600 shadow-sm ring-1 ring-brand-100' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 hover:scale-105'
                    }`}>
                    <motion.span whileHover={{ scale: 1.2, rotate: -8 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}><PackageCheck size={17} strokeWidth={2.3} /></motion.span> <span className="hidden lg:inline">Order History</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Successful Order History</TooltipContent>
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

      {view === 'calendar' ? (
        <main className="mx-auto max-w-3xl space-y-4 px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Calendar</h2>
              <p className="text-sm text-slate-500">Orders placed and upcoming AMC/warranty/repair-return events.</p>
            </div>
            <button onClick={() => window.close()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Close tab
            </button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <CombinedCalendar showToast={showToast} />
          </div>
        </main>
      ) : view === 'assets' ? (
        <AssetLifecyclePage
          key={historyNav.token}
          vendors={vendors}
          locations={locations}
          onBack={() => setView('dashboard')}
          showToast={showToast}
          initialQuery={historyNav.query}
          onModifyAdvancePayment={handleModifyAdvancePayment}
          onRecordDelivery={handleRecordDelivery}
          onEditPurchase={handleUpdatePurchase}
          onSummaryChange={loadSummary}
          onGoToAsset={handleGoToInventoryAsset}
        />
      ) : view === 'purchases' ? (
        <PurchasesPanel
          key={purchasesNav}
          loadPurchases={loadPurchases}
          loadSummary={loadSummary}
          usingMockData={usingMockData}
          summary={summary}
          query={query} setQuery={setQuery}
          status={status} setStatus={setStatus}
          sort={sort} setSort={setSort}
          debouncedQuery={debouncedQuery}
          setShowAddModal={setShowAddModal}
          showToast={showToast}
          purchases={purchases}
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
          onSummaryChange={loadSummary}
          onGoToAsset={handleGoToInventoryAsset}
        />
      ) : (
        <main className="mx-auto max-w-[1600px] space-y-6 px-6 py-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Inventory Management</h2>
            <p className="text-sm text-slate-500">Hardware, AMC contracts, and employee assignment lifecycles.</p>
          </div>

          <InventoryPage
            key={inventoryNav.token}
            vendors={vendors}
            locations={locations}
            showToast={showToast}
            initialQuery={inventoryNav.query}
            highlight={inventoryHighlight}
            embedded
            onSummaryChange={loadSummary}
            onInsuranceToggle={handleInsuranceToggle}
            onUploadPhotos={handleUploadPhotos}
            onUploadInvoices={handleUploadInvoices}
            onDeleteFile={handleDeleteFile}
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

// Same markup that used to live inline inside Dashboard's render — the
// difference is this is now a real component. Rendered with a `key`
// that changes on every navigation to Purchases (see purchasesNav in
// Dashboard), it mounts fresh each time, so this effect always fires
// and the page never depends on some other state having also changed
// to know it needs to fetch. Ongoing filter/sort/search changes while
// already on this tab are still handled by Dashboard's own
// query/status/sort-driven effect — this only covers "just arrived".
function PurchasesPanel({
  loadPurchases, loadSummary, usingMockData, summary,
  query, setQuery, status, setStatus, sort, setSort, debouncedQuery,
  setShowAddModal, showToast,
  purchases, loading, vendors, locations,
  onStatusChange, onDeleteClick, onInsuranceToggle, onUploadPhotos, onUploadInvoices,
  onDeleteFile, onModifyAdvancePayment, onCompleteMaintenance, onRecordDelivery,
  onEditPurchase, onApprovePurchase, onRejectPurchase,
}) {
  useEffect(() => {
    loadPurchases();
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: fire once on mount (i.e. once per arrival at this tab, via the `key` prop), not on every query/status/sort keystroke.
  }, []);

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 px-6 py-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Purchase Orders</h2>
        <p className="text-sm text-slate-500">Track spend, deliveries, and payment status across all vendors.</p>
      </div>

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
        onStatusChange={onStatusChange}
        onDeleteClick={onDeleteClick}
        onInsuranceToggle={onInsuranceToggle}
        onUploadPhotos={onUploadPhotos}
        onUploadInvoices={onUploadInvoices}
        onDeleteFile={onDeleteFile}
        onModifyAdvancePayment={onModifyAdvancePayment}
        onCompleteMaintenance={onCompleteMaintenance}
        onRecordDelivery={onRecordDelivery}
        onEditPurchase={onEditPurchase}
        onApprovePurchase={onApprovePurchase}
        onRejectPurchase={onRejectPurchase}
      />
    </main>
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