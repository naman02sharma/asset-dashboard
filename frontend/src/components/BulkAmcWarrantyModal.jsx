import { useState } from 'react';
import { X, ShieldCheck } from 'lucide-react';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/**
 * Applies the same AMC contract + warranty details to every selected
 * asset in one go — e.g. a batch of 10 laptops that all came with the
 * same 3-year AMC from the same vendor, instead of opening each one
 * individually and re-typing the same five fields ten times.
 *
 * Each field is optional and independent: leaving a field blank
 * leaves that field UNCHANGED on every selected asset (it's a
 * "set these fields" operation, not a full overwrite) — so, for
 * example, updating just the AMC end date across a batch doesn't
 * accidentally clear everyone's warranty_expiry. This mirrors
 * updateAsset's own semantics (undefined fields are left untouched)
 * since this reuses that same endpoint per-asset.
 */
export default function BulkAmcWarrantyModal({ assets, onClose, onSubmit }) {
  const [amcProvider, setAmcProvider] = useState('');
  const [amcStartDate, setAmcStartDate] = useState('');
  const [amcEndDate, setAmcEndDate] = useState('');
  const [amcCost, setAmcCost] = useState('');
  const [warrantyExpiry, setWarrantyExpiry] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const touched = amcProvider || amcStartDate || amcEndDate || amcCost || warrantyExpiry;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (amcStartDate && amcEndDate && amcEndDate < amcStartDate) {
      setError('AMC End Date cannot be earlier than AMC Start Date.');
      return;
    }
    if (!touched) {
      setError('Fill in at least one field to apply.');
      return;
    }

    const data = {};
    if (amcProvider) data.amc_provider = amcProvider;
    if (amcStartDate) data.amc_start_date = amcStartDate;
    if (amcEndDate) data.amc_end_date = amcEndDate;
    if (amcCost) data.amc_cost = amcCost;
    if (warrantyExpiry) data.warranty_expiry = warrantyExpiry;

    setSubmitting(true);
    try {
      const result = await onSubmit(assets.map((a) => a.id), data);
      if (result?.failed > 0) {
        setError(`${result.succeeded} updated, ${result.failed} failed.`);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-brand-600" />
            <h2 className="text-lg font-semibold text-slate-900">AMC / Warranty for {assets.length} Assets</h2>
          </div>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="mb-4 max-h-16 overflow-y-auto text-sm text-slate-500">
          {assets.map((a) => a.asset_tag || a.asset_name).join(', ')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">AMC provider</label>
            <input autoFocus className={FIELD_CLASS} value={amcProvider}
              onChange={(e) => setAmcProvider(e.target.value)} placeholder="Leave blank to keep unchanged" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">AMC start date</label>
              <input type="date" className={FIELD_CLASS} value={amcStartDate}
                onChange={(e) => setAmcStartDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">AMC end date</label>
              <input type="date" className={FIELD_CLASS} value={amcEndDate}
                onChange={(e) => setAmcEndDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">AMC cost (per asset)</label>
            <input type="number" min="0" step="0.01" className={FIELD_CLASS} value={amcCost}
              onChange={(e) => setAmcCost(e.target.value)} placeholder="Leave blank to keep unchanged" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Warranty expiry</label>
            <input type="date" className={FIELD_CLASS} value={warrantyExpiry}
              onChange={(e) => setWarrantyExpiry(e.target.value)} />
          </div>

          <p className="text-xs text-slate-400">Blank fields are left unchanged on every selected asset.</p>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-4 py-2 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-700 transition-all active:scale-95 disabled:opacity-50">
              {submitting ? 'Applying…' : 'Apply to selected'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}