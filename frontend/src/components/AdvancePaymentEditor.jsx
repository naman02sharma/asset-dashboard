import { useState } from 'react';
import { Pencil, Check, X, Loader2 } from 'lucide-react';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

/**
 * The dashboard's "Modify" toggle for Advance Money Paid.
 *
 * State-management note (dry-run): the draft input value lives in
 * local useState, seeded ONCE from the purchase prop when editing
 * starts (inside handleStartEdit, not a useEffect watching the prop).
 * There is deliberately no effect that re-syncs draftValue from the
 * prop while editing — that pattern (effect depends on a prop that
 * a save-triggered re-render would also change) is exactly what
 * causes the infinite-loop bug class this task called out. Instead:
 * edit locally -> Save calls the parent's onSave once -> parent
 * refetches/replaces the row from the server response -> this
 * component unmounts back to view mode. One-directional, one save
 * per click, no watcher loop possible.
 */
export default function AdvancePaymentEditor({ purchase, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleStartEdit() {
    setDraftValue(String(purchase.amount_paid));
    setError('');
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setError('');
  }

  async function handleSave() {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('Enter a valid amount.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(purchase.id, parsed);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={handleStartEdit}
        title="Modify amount paid"
        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-brand-600 group-hover:opacity-100"
      >
        <Pencil size={12} />
      </button>
    );
  }

  // Previously clamped to Math.max(0, ...), which hid overpayment
  // entirely — typing a value larger than total_cost (e.g. an
  // accidental extra digit) just showed "New remaining: ₹0", identical
  // to a normal fully-paid order, so nothing ever caught the mistake.
  // Showing the true (possibly negative) number, with the label
  // switching to a red "Overpaid by" warning, is what actually gives a
  // typo like that a chance to be noticed before Save.
  const previewTotal = Number(purchase.total_cost) || 0;
  const previewPaid = Number.isFinite(Number(draftValue)) ? Number(draftValue) : 0;
  const previewRemaining = previewTotal - previewPaid;
  const isOverpaid = previewRemaining < 0;

  return (
    <div className="absolute z-10 w-48 rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg animate-[scaleIn_0.1s_ease-out]">
      <label className="mb-1 block text-[11px] font-medium text-slate-500">Advance money paid (₹)</label>
      <input
        autoFocus
        type="number"
        min="0"
        step="0.01"
        value={draftValue}
        onChange={(e) => setDraftValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
        className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {isOverpaid ? (
        <p className="mt-1 text-[11px] font-medium text-red-600">⚠ Overpaid by {currency(Math.abs(previewRemaining))} — total is only {currency(previewTotal)}</p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-400">New remaining: <span className="font-mono">{currency(previewRemaining)}</span></p>
      )}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      <div className="mt-2 flex justify-end gap-1">
        <button onClick={handleCancel} disabled={saving}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
          <X size={13} />
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
        </button>
      </div>
    </div>
  );
}
