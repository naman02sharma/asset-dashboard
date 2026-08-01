import { useState } from 'react';
import { X } from 'lucide-react';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

// Edit-only (locations are still auto-created via the New Purchase /
// New Asset location autocomplete — see findOrCreateLocation in
// purchaseController.js — the same create path vendors use), so this
// modal only ever runs in 'edit' mode. Kept as a mode prop anyway to
// match VendorFormModal's shape in case a direct "Add Location" entry
// point gets added later.
export default function LocationFormModal({ mode = 'edit', location, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: location?.name || '',
    address: location?.address || '',
    gst_number: location?.gst_number || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{mode === 'create' ? 'Add Location' : 'Edit Location'}</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <form id="location-form" onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Location Name</label>
            <input required autoFocus className={FIELD_CLASS} value={form.name}
              onChange={(e) => update('name', e.target.value)} placeholder="e.g. Mumbai HQ, Warehouse B" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">GST Number</label>
            <input className={FIELD_CLASS} value={form.gst_number}
              onChange={(e) => update('gst_number', e.target.value)} placeholder="GSTIN" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Address</label>
            <textarea className={FIELD_CLASS} rows={3} value={form.address}
              onChange={(e) => update('address', e.target.value)} placeholder="Physical address..." />
          </div>

          {location?.code && (
            <p className="text-xs text-slate-400">
              PO-number prefix <span className="font-mono font-medium text-slate-500">{location.code}</span> can't be changed here — it's already baked into every PO number issued for this location.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" form="location-form" disabled={submitting}
            className="rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-700 disabled:opacity-60 active:scale-95 transition-all">
            {submitting ? 'Saving...' : 'Save Location'}
          </button>
        </div>
      </div>
    </div>
  );
}
