import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button.jsx';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

export default function VendorFormModal({ mode = 'create', vendor, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: vendor?.name || '',
    website: vendor?.website || '',
    gst_number: vendor?.gst_number || '',
    address: vendor?.address || '',
    contact_phone: vendor?.contact_phone || '',
    contact_email: vendor?.contact_email || '',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{mode === 'create' ? 'Add Vendor' : 'Edit Vendor'}</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <form id="vendor-form" onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Vendor Name</label>
            <input required className={FIELD_CLASS} value={form.name}
              onChange={(e) => update('name', e.target.value)} placeholder="e.g. Dell India" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">GST Number</label>
              <input className={FIELD_CLASS} value={form.gst_number}
                onChange={(e) => update('gst_number', e.target.value)} placeholder="GSTIN" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Website</label>
              <input className={FIELD_CLASS} value={form.website}
                onChange={(e) => update('website', e.target.value)} placeholder="https://..." />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Contact Email</label>
              <input type="email" className={FIELD_CLASS} value={form.contact_email}
                onChange={(e) => update('contact_email', e.target.value)} placeholder="sales@example.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Contact Phone</label>
              <input type="tel" className={FIELD_CLASS} value={form.contact_phone}
                onChange={(e) => update('contact_phone', e.target.value)} placeholder="Phone number" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Address / Description</label>
            <textarea className={FIELD_CLASS} rows={3} value={form.address}
              onChange={(e) => update('address', e.target.value)} placeholder="Physical address or additional details..." />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <Button type="submit" form="vendor-form" loading={submitting}>
            {submitting ? 'Saving...' : 'Save Vendor'}
          </Button>
        </div>
      </div>
    </div>
  );
}
