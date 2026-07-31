import { useState } from 'react';
import { X } from 'lucide-react';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

// Tomorrow, as 'YYYY-MM-DD' — used as the <input type="date"> min so
// the browser itself prevents picking today/a past date, matching the
// backend's "expected return date must be in the future" validation.
function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * "Maintenance Dispatch" — asks who took the item (technician/vendor +
 * contact) and when it's expected back. Shown whenever an asset's
 * status is being changed to Under Repair, whether it was previously
 * Available or In Use (see assetController.dispatchToMaintenance for
 * what happens to an in-progress employee assignment in that case).
 */
export default function MaintenanceDispatchModal({ asset, onClose, onSubmit }) {
  const [handledBy, setHandledBy] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState(tomorrowISO());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onSubmit(asset.id, {
        handled_by: handledBy,
        contact_info: contactInfo || null,
        expected_return_date: expectedReturnDate,
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
          <h2 className="text-lg font-semibold text-slate-900">Send for Maintenance</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500">{asset.asset_name}</p>
        {asset.status === 'in_use' && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            This asset is currently assigned to <strong>{asset.current_employee_name}</strong> — sending it
            for repair will close out that assignment.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Technician / vendor name</label>
            <input required autoFocus className={FIELD_CLASS} value={handledBy}
              onChange={(e) => setHandledBy(e.target.value)} placeholder="Who is taking the item?" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Contact info (optional)</label>
            <input className={FIELD_CLASS} value={contactInfo} onChange={(e) => setContactInfo(e.target.value)}
              placeholder="Phone or email" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Expected return date</label>
            <input required type="date" min={tomorrowISO()} className={FIELD_CLASS} value={expectedReturnDate}
              onChange={(e) => setExpectedReturnDate(e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
              {submitting ? 'Sending…' : 'Send for Repair'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
