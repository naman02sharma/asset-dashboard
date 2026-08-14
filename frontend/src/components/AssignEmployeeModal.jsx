import { useState } from 'react';
import { X, UserPlus } from 'lucide-react';
import { Button } from './ui/button.jsx';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 transition-colors';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * "Assign/Handover" — free-text employee name with autocomplete
 * (same pattern as vendor/location elsewhere in this app): the
 * backend looks up a match by name or creates a new employee record.
 *
 * Location and department are captured as point-in-time SNAPSHOTS on
 * the assignment record itself (see asset_holdings.department_snapshot
 * / location_name_snapshot, migration 020) — so the History/Trail
 * timeline always shows what was true when THIS assignment happened,
 * even if the employee's location/department changes later. Date
 * assigned defaults to today but is editable, for logging a handover
 * that actually happened earlier.
 */
export default function AssignEmployeeModal({ asset, employees, locations, onClose, onSubmit }) {
  const [employeeName, setEmployeeName] = useState('');
  const [locationName, setLocationName] = useState('');
  const [department, setDepartment] = useState('');
  const [startedAt, setStartedAt] = useState(todayIso());
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (expectedReturnDate && expectedReturnDate < startedAt) {
      setError('Return date cannot be earlier than the date the asset is assigned.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(asset.id, {
        employee_name: employeeName,
        location_name: locationName || null,
        department: department || null,
        started_at: startedAt,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl animate-[scaleIn_0.15s_ease-out]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <UserPlus size={15} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Assign Asset</h2>
              <p className="text-xs text-slate-400">{asset.asset_name}</p>
            </div>
          </div>
          <button onClick={onClose} title="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Employee name</label>
            <input
              required autoFocus list="employee-suggestions" className={FIELD_CLASS}
              value={employeeName} onChange={(e) => setEmployeeName(e.target.value)}
              placeholder="Type a name — new or existing"
            />
            <datalist id="employee-suggestions">
              {employees?.map((e) => <option key={e.id} value={e.name} />)}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Location</label>
              <input list="assign-location-suggestions" className={FIELD_CLASS} value={locationName}
                onChange={(e) => setLocationName(e.target.value)} placeholder="Optional" />
              <datalist id="assign-location-suggestions">
                {locations?.map((l) => <option key={l.id} value={l.name} />)}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Department</label>
              <input className={FIELD_CLASS} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Date assigned</label>
              <input required type="date" className={FIELD_CLASS} value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Return date</label>
              <input type="date" className={FIELD_CLASS} value={expectedReturnDate} min={startedAt || undefined}
                onChange={(e) => setExpectedReturnDate(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
              Cancel
            </button>
            <Button type="submit" loading={submitting}>
              {submitting ? 'Assigning…' : 'Assign'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
