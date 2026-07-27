import { useState } from 'react';
import { X, UserPlus } from 'lucide-react';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/**
 * Same "Assign/Handover" flow as AssignEmployeeModal, but for several
 * selected assets at once — e.g. handing 5 laptops from one batch to
 * the same new hire in one go instead of assigning them one at a
 * time. Only assets currently 'available' can actually be assigned —
 * the caller (InventoryPage) already filters `assets` down to just
 * that eligible subset before opening this modal (a broader selection
 * like a whole batch group naturally includes units already in use or
 * under repair too; those are simply left untouched rather than
 * blocking the ones that ARE eligible), and passes `skippedCount` so
 * that's visible here rather than being a silent surprise.
 */
export default function BulkAssignModal({ assets, skippedCount = 0, employees, onClose, onSubmit }) {
  const [employeeName, setEmployeeName] = useState('');
  const [department, setDepartment] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await onSubmit(assets.map((a) => a.id), {
        employee_name: employeeName,
        department: department || null,
        expected_return_date: expectedReturnDate || null,
      });
      if (result?.failed > 0) {
        setError(`${result.succeeded} assigned, ${result.failed} failed — check they were all still Available.`);
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
            <UserPlus size={16} className="text-brand-600" />
            <h2 className="text-lg font-semibold text-slate-900">Assign {assets.length} Assets</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="mb-1 max-h-16 overflow-y-auto text-sm text-slate-500">
          {assets.map((a) => a.asset_tag || a.asset_name).join(', ')}
        </p>
        {skippedCount > 0 && (
          <p className="mb-4 text-xs text-amber-600">
            {skippedCount} other selected asset{skippedCount === 1 ? '' : 's'} skipped — not currently Available.
          </p>
        )}
        {skippedCount === 0 && <div className="mb-4" />}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Employee or department</label>
            <input
              required autoFocus list="bulk-employee-suggestions" className={FIELD_CLASS}
              value={employeeName} onChange={(e) => setEmployeeName(e.target.value)}
              placeholder="Type a name — new or existing"
            />
            <datalist id="bulk-employee-suggestions">
              {employees?.map((e) => <option key={e.id} value={e.name} />)}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Department (optional)</label>
            <input className={FIELD_CLASS} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Engineering" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Expected return date (optional)</label>
            <input type="date" className={FIELD_CLASS} value={expectedReturnDate}
              onChange={(e) => setExpectedReturnDate(e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              {submitting ? 'Assigning…' : `Assign all ${assets.length}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
