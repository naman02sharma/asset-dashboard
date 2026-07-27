import { useState } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/**
 * Create or edit an inventory item's core purchase details and AMC
 * fields. In edit mode, every changed field gets logged to that
 * asset's History/Trail automatically by the backend (updateAsset) —
 * this form doesn't need to know or do anything special about that.
 */
export default function AssetFormModal({ mode = 'create', asset, vendors, onClose, onSubmit }) {
  const [form, setForm] = useState({
    asset_name: asset?.asset_name || '',
    category: asset?.category || '',
    serial_number: asset?.serial_number || '',
    asset_tag: asset?.asset_tag || '',
    location: asset?.location || '',
    vendor_name: asset?.vendor_name || '',
    purchase_date: asset?.purchase_date || '',
    cost: asset?.cost ?? '',
    warranty_expiry: asset?.warranty_expiry || '',
    useful_life_years: asset?.useful_life_years || '',
    amc_provider: asset?.amc_provider || '',
    amc_start_date: asset?.amc_start_date || '',
    amc_end_date: asset?.amc_end_date || '',
    amc_cost: asset?.amc_cost ?? '',
  });
  const [showAmc, setShowAmc] = useState(!!asset?.amc_provider);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // Client-side mirror of the backend's AMC date-order check — catches
    // the mistake before a round trip instead of only after.
    if (form.amc_start_date && form.amc_end_date && form.amc_end_date < form.amc_start_date) {
      setError('AMC End Date cannot be earlier than AMC Start Date.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{mode === 'create' ? 'New Asset' : 'Edit Asset'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <form id="asset-form" onSubmit={handleSubmit} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Asset name</label>
            <input required className={FIELD_CLASS} value={form.asset_name}
              onChange={(e) => update('asset_name', e.target.value)} placeholder="e.g. Dell Latitude 5440 (SN: XJ2201)" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Category</label>
              <input className={FIELD_CLASS} value={form.category}
                onChange={(e) => update('category', e.target.value)} placeholder="e.g. Laptop" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Serial number</label>
              <input className={FIELD_CLASS} value={form.serial_number}
                onChange={(e) => update('serial_number', e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Asset tag</label>
              <input className={FIELD_CLASS} value={form.asset_tag}
                onChange={(e) => update('asset_tag', e.target.value)} placeholder="e.g. IT-2026-014" />
              <p className="mt-0.5 text-[11px] text-slate-400">Your own tracking code for physical tagging/scanning — must be unique.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Location</label>
              <input className={FIELD_CLASS} value={form.location}
                onChange={(e) => update('location', e.target.value)} placeholder="e.g. HO – 3rd Floor" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Vendor</label>
            <input list="asset-vendor-suggestions" className={FIELD_CLASS} value={form.vendor_name}
              onChange={(e) => update('vendor_name', e.target.value)} placeholder="Type a vendor name — new or existing" />
            <datalist id="asset-vendor-suggestions">
              {vendors?.map((v) => <option key={v.id} value={v.name} />)}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Purchase date</label>
              <input type="date" className={FIELD_CLASS} value={form.purchase_date}
                onChange={(e) => update('purchase_date', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Cost (₹)</label>
              <input type="number" min="0" step="0.01" className={FIELD_CLASS} value={form.cost}
                onChange={(e) => update('cost', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Warranty expiry</label>
              <input type="date" className={FIELD_CLASS} value={form.warranty_expiry}
                onChange={(e) => update('warranty_expiry', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Useful life (years)</label>
              <input type="number" min="1" step="1" className={FIELD_CLASS} value={form.useful_life_years}
                onChange={(e) => update('useful_life_years', e.target.value)} placeholder="Optional" />
              <p className="mt-0.5 text-[11px] text-slate-400">Leave blank to skip depreciation tracking for this asset.</p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <button type="button" onClick={() => setShowAmc((s) => !s)}
              className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              {showAmc ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              AMC (Annual Maintenance Contract) details
            </button>

            {showAmc && (
              <div className="mt-2 space-y-2">
                <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-500">
                  An AMC (Annual Maintenance Contract) is a paid agreement with a
                  vendor to service/repair this asset for a fixed period — enter
                  who the provider is, the contract's start/end dates, and its
                  cost. Once <strong>End date</strong> is within 30 days, this
                  asset is automatically flagged "AMC expiring" on the Inventory
                  list and stat strip, so renewal doesn't get missed.
                </p>
                <input className={FIELD_CLASS} value={form.amc_provider}
                  onChange={(e) => update('amc_provider', e.target.value)} placeholder="AMC provider" />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-0.5 block text-[11px] text-slate-400">Start date</label>
                    <input type="date" className={FIELD_CLASS} value={form.amc_start_date}
                      onChange={(e) => update('amc_start_date', e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] text-slate-400">End date</label>
                    <input type="date" className={FIELD_CLASS} value={form.amc_end_date}
                      min={form.amc_start_date || undefined}
                      onChange={(e) => update('amc_end_date', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">AMC cost (₹)</label>
                  <input type="number" min="0" step="0.01" className={`${FIELD_CLASS} w-32`} value={form.amc_cost}
                    onChange={(e) => update('amc_cost', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" form="asset-form" disabled={submitting}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {submitting ? 'Saving…' : mode === 'create' ? 'Create Asset' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
