import { useState } from 'react';
import { X } from 'lucide-react';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/**
 * "Assign/Handover" — free-text employee name with autocomplete
 * (same pattern as vendor/location elsewhere in this app): the
 * backend looks up a match by name or creates a new employee record.
 */
export default function AssignEmployeeModal({ asset, employees, onClose, onSubmit }) {
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
      await onSubmit(asset.id, {
        employee_name: employeeName,
        department: department || null,
        expected_return_date: expectedReturnDate || null,
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
          <h2 className="text-lg font-semibold text-slate-900">Assign Asset</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500">{asset.asset_name}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Employee or department</label>
            <input
              required autoFocus list="employee-suggestions" className={FIELD_CLASS}
              value={employeeName} onChange={(e) => setEmployeeName(e.target.value)}
              placeholder="Type a name — new or existing"
            />
            <datalist id="employee-suggestions">
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
              {submitting ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
