import { AlertTriangle, Archive, Trash2, X } from 'lucide-react';

/**
 * Shown when the trash icon on a table row is clicked. Deliberately
 * makes "Move to History" the visually safer/primary option and
 * "Delete Permanently" the harder-to-misclick destructive one.
 */
export default function DeleteConfirmModal({ purchase, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900">
            <AlertTriangle size={18} className="text-amber-500" />
            <h2 className="text-base font-semibold">Delete this purchase?</h2>
          </div>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-sm text-slate-500">
          <span className="font-medium text-slate-700">{purchase.item_name}</span> — choose whether to keep a
          record of it or remove it entirely.
        </p>

        <div className="space-y-2">
          <button
            onClick={() => onConfirm('history')}
            className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3.5 py-3 text-left hover:bg-slate-50 transition-colors"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Archive size={15} />
            </span>
            <span>
              <span className="block text-sm font-medium text-slate-800">Move to History</span>
              <span className="block text-xs text-slate-500">Kept for 3 months, then removed automatically. Restorable anytime.</span>
            </span>
          </button>

          <button
            onClick={() => onConfirm('permanent')}
            className="flex w-full items-center gap-3 rounded-lg border border-red-200 px-3.5 py-3 text-left hover:bg-red-50 transition-colors"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
              <Trash2 size={15} />
            </span>
            <span>
              <span className="block text-sm font-medium text-red-700">Delete Permanently</span>
              <span className="block text-xs text-red-500">Cannot be undone.</span>
            </span>
          </button>
        </div>

        <button onClick={onClose} title="Close"
          className="mt-4 w-full rounded-lg py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
