import { useState } from 'react';
import { X, CheckCircle2, Wrench } from 'lucide-react';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

const todayISO = () => new Date().toISOString().slice(0, 10);
const formatDisplayDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * "Return Asset" — used for both an employee returning an item and an
 * item coming back from repair (the backend treats both the same way:
 * whichever holding is currently open gets closed). The admin
 * explicitly picks the resulting status rather than it being inferred
 * from the condition note text — e.g. an employee return noting
 * "Broken keyboard" should go to Under Repair, not Available, and
 * free-text parsing to guess that would be fragile.
 */
export default function ReturnAssetModal({ asset, onClose, onSubmit }) {
  const isFromRepair = asset.current_holder_type === 'repair';
  // The assignment/repair-dispatch start date — the backend rejects any
  // return date earlier than this (see assetController.returnAsset).
  // Surfacing it here (as both a hint and the date input's `min`) means
  // the picker can't land on a date the backend will reject anyway,
  // instead of the admin discovering the constraint only after
  // submitting and reading the error.
  const startedAt = asset.current_holding_started_at || null;
  const today = todayISO();
  // Guards against a clock-skew edge case (started_at somehow after
  // today) rather than defaulting to an initial value the min/max
  // bounds would immediately reject.
  const initialReturnedAt = startedAt && startedAt > today ? startedAt : today;
  const [returnedAt, setReturnedAt] = useState(initialReturnedAt);
  const [conditionNote, setConditionNote] = useState('');
  const [resultingStatus, setResultingStatus] = useState('available');
  const [repairCost, setRepairCost] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (startedAt && returnedAt < startedAt) {
      setError('Return Date cannot be earlier than the assignment start date.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(asset.id, {
        returned_at: returnedAt,
        condition_note: conditionNote || null,
        resulting_status: resultingStatus,
        ...(isFromRepair ? { repair_cost: repairCost } : {}),
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {isFromRepair ? 'Return from Maintenance' : 'Return Asset'}
          </h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          {asset.asset_name}
          {isFromRepair
            ? asset.current_repair_vendor && ` — with ${asset.current_repair_vendor}`
            : asset.current_employee_name && ` — held by ${asset.current_employee_name}`}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Return date</label>
            <input required type="date" min={startedAt || undefined} max={todayISO()} className={FIELD_CLASS} value={returnedAt}
              onChange={(e) => setReturnedAt(e.target.value)} />
            {startedAt && (
              <p className="mt-1 text-[11px] text-slate-400">
                {isFromRepair ? 'Sent for repair' : 'Assigned'} on {formatDisplayDate(startedAt)} — the return date can't be earlier than that.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Condition note</label>
            <input autoFocus className={FIELD_CLASS} value={conditionNote}
              onChange={(e) => setConditionNote(e.target.value)}
              placeholder='e.g. "Working fine" or "Broken keyboard"' />
          </div>

          {isFromRepair && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Repair cost (₹)</label>
              <input type="number" min="0" step="0.01" className={FIELD_CLASS} value={repairCost}
                onChange={(e) => setRepairCost(e.target.value)} placeholder="Optional — from the vendor's invoice" />
              <p className="mt-0.5 text-[11px] text-slate-400">Counted in Inventory's "Maintenance & AMC Spend" total.</p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Set asset status to</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setResultingStatus('available')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm transition-colors ${
                  resultingStatus === 'available' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'
                }`}>
                <CheckCircle2 size={14} /> Available
              </button>
              <button type="button" onClick={() => setResultingStatus('under_repair')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm transition-colors ${
                  resultingStatus === 'under_repair' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500'
                }`}>
                <Wrench size={14} /> Still needs repair
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-700 disabled:opacity-60 active:scale-95 transition-all">
              {submitting ? 'Saving…' : 'Confirm Return'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
