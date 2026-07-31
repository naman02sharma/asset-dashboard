import { useState } from 'react';
import { Pencil, Check, X, Loader2 } from 'lucide-react';

/**
 * Inventory's "Modify" toggle — same interaction pattern as
 * AdvancePaymentEditor on the Purchases table: a small pencil icon
 * (visible on row hover) opens a compact inline popover to correct a
 * couple of fields directly, without leaving the table or opening the
 * full Edit Asset modal.
 *
 * Scoped to the two fields people actually need to touch often — Cost
 * and Warranty Expiry — rather than every editable field (category,
 * serial number, AMC, etc. still go through "Edit" in the detail
 * drawer, which already handles those with full validation and the
 * asset_change_log audit trail).
 *
 * Same one-directional state flow as AdvancePaymentEditor: draft
 * values are seeded once from the asset prop when editing starts, Save
 * calls the parent's onSave once, and the parent's fresh server
 * response replaces the row — no effect re-syncing a prop while
 * editing, so there's no risk of the infinite-loop bug that pattern
 * causes.
 */
export default function AssetModifyEditor({ asset, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draftCost, setDraftCost] = useState('');
  const [draftWarranty, setDraftWarranty] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleStartEdit() {
    setDraftCost(asset.cost != null ? String(asset.cost) : '');
    setDraftWarranty(asset.warranty_expiry || '');
    setError('');
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setError('');
  }

  async function handleSave() {
    if (draftCost !== '' && (!Number.isFinite(Number(draftCost)) || Number(draftCost) < 0)) {
      setError('Enter a valid cost.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(asset.id, { cost: draftCost === '' ? '' : draftCost, warranty_expiry: draftWarranty });
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
        title="Modify cost / warranty"
        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-brand-600 group-hover:opacity-100"
      >
        <Pencil size={12} />
      </button>
    );
  }

  return (
    <div className="absolute z-10 w-56 rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg animate-[scaleIn_0.1s_ease-out]">
      <label className="mb-1 block text-[11px] font-medium text-slate-500">Cost (₹)</label>
      <input
        autoFocus
        type="number"
        min="0"
        step="0.01"
        value={draftCost}
        onChange={(e) => setDraftCost(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
        className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />

      <label className="mb-1 mt-2 block text-[11px] font-medium text-slate-500">Warranty expiry</label>
      <input
        type="date"
        value={draftWarranty}
        onChange={(e) => setDraftWarranty(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
        className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />

      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      <div className="mt-2 flex justify-end gap-1">
        <button onClick={handleCancel} title="Cancel" disabled={saving}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
          <X size={13} />
        </button>
        <button onClick={handleSave} disabled={saving} title="Save"
          className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
        </button>
      </div>
    </div>
  );
}
