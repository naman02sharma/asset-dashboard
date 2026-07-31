import { useState } from 'react';
import { Clock, CheckCircle2, XCircle, User, Hash, Loader2 } from 'lucide-react';

// Central source of truth for approval_status -> color mapping, same
// pattern as StatusBadge's STATUS_STYLES.
export const APPROVAL_STYLES = {
  pending:  { label: 'Pending Approval', icon: Clock,        text: 'text-amber-700', bg: 'bg-amber-50',  ring: 'ring-amber-300' },
  approved: { label: 'Approved',         icon: CheckCircle2, text: 'text-green-700', bg: 'bg-green-50',  ring: 'ring-green-200' },
  rejected: { label: 'Rejected',         icon: XCircle,      text: 'text-red-700',   bg: 'bg-red-50',    ring: 'ring-red-200'   },
};

/**
 * Compact pill — used anywhere a full-width row/card doesn't make
 * sense (e.g. a dense table cell). A soft pulse on the icon while
 * pending draws the eye without being distracting once approved.
 */
export function ApprovalStatusBadge({ status }) {
  const style = APPROVAL_STYLES[status] || APPROVAL_STYLES.pending;
  const Icon = style.icon;
  return (
    <span
      title={style.label}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${style.bg} ${style.text} ${style.ring}`}
    >
      <Icon size={10} className={status === 'pending' ? 'animate-pulse' : ''} />
      {style.label}
    </span>
  );
}

/**
 * Small persistent line showing who created and who approved/rejected
 * an item -- unlike ApprovalPanel (which only renders while pending/
 * rejected), this shows regardless of status, so the provenance stays
 * visible even after approval rather than disappearing the moment
 * it's resolved. Renders nothing if neither name is available.
 */
export function CreatorApproverLine({ item }) {
  if (!item.requested_by_name && !item.approved_by_name) return null;
  return (
    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
      <User size={10} className="shrink-0 text-slate-300" />
      {item.requested_by_name && <span title={item.requested_by_phone ? `Phone: ${item.requested_by_phone}` : undefined}>Created by {item.requested_by_name}</span>}
      {item.requested_by_name && item.approved_by_name && <span>·</span>}
      {item.approved_by_name && (
        <span>{item.approval_status === 'rejected' ? 'Rejected' : 'Approved'} by {item.approved_by_name}</span>
      )}
    </p>
  );
}

/**
 * Full panel: shown inline under a pending/rejected purchase or asset
 * row so it's genuinely eye-catching ("attractive" per spec) rather
 * than a plain gray label — a soft amber gradient card carrying who
 * requested it, its PO number, and (for admin/senior) Approve/Reject
 * buttons right there, no separate page needed. Renders nothing once
 * approved (status stops being interesting at that point — the row
 * just looks like every other row again).
 *
 * `item` is a purchase_summary or asset_summary row — both carry the
 * same approval_status / requested_by_name / requested_by_phone /
 * po_number / rejection_reason columns (018/019 migrations), so this
 * component works unmodified for either.
 */
export function ApprovalPanel({ item, canApprove, onApprove, onReject }) {
  const [busy, setBusy] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [reason, setReason] = useState('');

  if (!item.approval_status || item.approval_status === 'approved') return null;

  const isPending = item.approval_status === 'pending';

  async function handleApprove() {
    setBusy(true);
    try {
      await onApprove(item.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!showRejectReason) {
      setShowRejectReason(true);
      return;
    }
    setBusy(true);
    try {
      await onReject(item.id, reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-2.5 py-2 ${
        isPending
          ? 'border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 bg-[length:200%_100%] animate-[shimmer_3s_ease-in-out_infinite]'
          : 'border-red-200 bg-red-50'
      }`}
    >
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isPending ? 'text-amber-800' : 'text-red-800'}`}>
        {isPending ? <Clock size={13} className="animate-pulse" /> : <XCircle size={13} />}
        {isPending ? 'Pending approval' : 'Rejected'}
      </span>

      {item.requested_by_name && (
        <span className="inline-flex items-center gap-1 text-xs text-slate-600" title={item.requested_by_phone ? `Phone: ${item.requested_by_phone}` : undefined}>
          <User size={11} className="text-slate-400" /> {item.requested_by_name}
        </span>
      )}

      {item.po_number && (
        <span className="inline-flex items-center gap-1 rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[11px] text-slate-700" title="PO number">
          <Hash size={10} className="text-slate-400" /> {item.po_number}
        </span>
      )}

      {!isPending && item.rejection_reason && (
        <span className="text-xs italic text-red-700">"{item.rejection_reason}"</span>
      )}

      {isPending && canApprove && (
        <div className="ml-auto flex items-center gap-1.5">
          {showRejectReason && (
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              title="Optional reason shown to whoever requested this"
              className="w-40 rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-red-400 focus:outline-none"
            />
          )}
          <button
            type="button"
            onClick={handleApprove}
            disabled={busy}
            title="Approve — feeds this into the dashboard/Inventory"
            className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            Approve
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={busy}
            title={showRejectReason ? 'Confirm rejection' : 'Reject'}
            className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
            {showRejectReason ? 'Confirm' : 'Reject'}
          </button>
        </div>
      )}
    </div>
  );
}
