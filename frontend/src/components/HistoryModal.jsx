import { useEffect, useState } from 'react';
import { X, RotateCcw, Trash2, Archive } from 'lucide-react';
import { api } from '../api/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * Lists purchases moved to History (soft-deleted). Each item can be
 * restored back to the active table or deleted permanently. Anything
 * sitting here past 3 months is purged automatically by the backend
 * cron job (trackingService.js -> purgeOldHistory()) — this view just
 * reflects that window, it doesn't enforce it client-side.
 */
export default function HistoryModal({ onClose, onChanged }) {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      setItems(await api.getHistory());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRestore(id) {
    setBusyId(id);
    try {
      await api.restorePurchase(id);
      setItems((rows) => rows.filter((r) => r.id !== id));
      onChanged('Purchase restored.');
    } catch (err) {
      onChanged(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handlePermanentDelete(id) {
    setBusyId(id);
    try {
      await api.deletePurchase(id, 'permanent');
      setItems((rows) => rows.filter((r) => r.id !== id));
      onChanged('Purchase permanently deleted.');
    } catch (err) {
      onChanged(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Archive size={17} className="text-slate-400" />
            <h2 className="text-lg font-semibold text-slate-900">Deleted Items</h2>
          </div>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <p className="border-b border-slate-100 bg-slate-50/60 px-6 py-2 text-xs text-slate-500">
          Deleted purchases are kept here for 3 months before being permanently removed.
        </p>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading && <p className="py-8 text-center text-sm text-slate-400">Loading…</p>}
          {!loading && items.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">No deleted items right now.</p>
          )}
          <ul className="divide-y divide-slate-100">
            {items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{p.item_name}</p>
                  <p className="text-xs text-slate-400">
                    {p.vendor_name} · {currency(p.total_cost_with_tax ?? p.total_cost)} · moved to history {dateFmt(p.archived_at)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {isAdmin ? (
                    <>
                      <button
                        disabled={busyId === p.id}
                        onClick={() => handleRestore(p.id)}
                        title="Restore"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 transition-all"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        disabled={busyId === p.id}
                        onClick={() => handlePermanentDelete(p.id)}
                        title="Delete permanently"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    <span className="text-[11px] text-slate-400">Admin only</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
