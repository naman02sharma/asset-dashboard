import { useEffect, useState } from 'react';
import { X, History, Truck, IndianRupee, Pencil, Loader2 } from 'lucide-react';
import { api } from '../api/api.js';

const currency = (n) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const STATUS_LABELS = {
  ordered: 'Ordered', processing: 'Processing', shipped: 'Shipped',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', delayed: 'Delayed',
};

/**
 * Purchases' equivalent of AssetDetailDrawer's History/Trail timeline —
 * same idea (merge a few append-only logs into one chronological
 * feed), same visual language (dotted vertical line, colored icon
 * dots). Rendered as the same centered, backdrop-covered modal every
 * other popup in the app uses (see DeleteConfirmModal, HistoryModal,
 * EditPurchaseModal, ...) — this used to be pinned to the History
 * icon's own on-screen position instead, which meant it opened in a
 * different spot depending on which row you clicked, sometimes right
 * at the edge of the screen. Centering it keeps every popup in the
 * app opening in the same predictable place.
 *
 * Pulls from GET /purchases/:id/audit, which merges:
 *  - delivery_events   → every status change, manual or courier-driven
 *  - payments          → every amount actually recorded
 *  - financial_audit_log → every "Modify" edit to Advance Money Paid
 * These were already being written on every relevant action; this is
 * the first UI that reads them back.
 */
export default function PurchaseHistoryModal({ purchaseId, itemName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getPurchaseAudit(purchaseId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [purchaseId]);

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const timeline = data ? buildTimeline(data) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl animate-[scaleIn_0.15s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <History size={15} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">History</h2>
              {itemName && <p className="text-xs text-slate-400">{itemName}</p>}
            </div>
          </div>
          <button onClick={onClose} title="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && timeline.length === 0 && (
            <p className="text-sm text-slate-400">No activity logged yet.</p>
          )}
          {!loading && !error && timeline.length > 0 && (
            <ol className="space-y-1">
              {timeline.map((entry) => (
                <li key={entry.key} className="relative flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${entry.dotClass}`}>
                    <entry.icon size={11} className="text-white" />
                  </span>
                  <div className="min-w-0 flex-1 pb-1">
                    <p className="text-sm leading-snug text-slate-700">{entry.text}</p>
                    <p className="text-xs text-slate-400">{entry.dateLabel}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function buildTimeline({ deliveryEvents, payments, financialAuditLog }) {
  const entries = [];

  for (const e of deliveryEvents) {
    entries.push({
      key: `d-${e.id}`,
      sortDate: e.occurred_at,
      text: `Status changed to ${STATUS_LABELS[e.status] || e.status}${e.source === 'courier_webhook' ? ' (auto-tracked)' : ''}${e.note ? ` — ${e.note}` : ''}`,
      dateLabel: new Date(e.occurred_at).toLocaleString('en-IN'),
      icon: Truck,
      dotClass: 'bg-blue-500',
    });
  }

  for (const p of payments) {
    // "Adjustment (Modify)" rows are the ledger-side effect of an
    // Advance-Payment edit — the financial_audit_log loop below
    // already reports that same event with clearer before/after
    // totals, so skip it here to avoid showing it twice.
    if (p.method === 'Adjustment (Modify)') continue;
    entries.push({
      key: `p-${p.id}`,
      sortDate: p.created_at || p.paid_on,
      text: `Payment of ${currency(p.amount)} recorded${p.method ? ` (${p.method})` : ''}`,
      dateLabel: new Date(p.created_at || p.paid_on).toLocaleString('en-IN'),
      icon: IndianRupee,
      dotClass: 'bg-green-500',
    });
  }

  for (const c of financialAuditLog) {
    entries.push({
      key: `f-${c.id}`,
      sortDate: c.changed_at,
      text: `Advance Money Paid changed: ${currency(c.previous_value)} → ${currency(c.new_value)}${c.changed_by_name ? ` by ${c.changed_by_name}` : ''}`,
      dateLabel: new Date(c.changed_at).toLocaleString('en-IN'),
      icon: Pencil,
      dotClass: 'bg-slate-400',
    });
  }

  return entries.sort((a, b) => (a.sortDate < b.sortDate ? 1 : -1));
}
