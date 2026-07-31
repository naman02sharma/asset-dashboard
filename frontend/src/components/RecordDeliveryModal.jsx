import { useState } from 'react';
import { X, Truck } from 'lucide-react';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 transition-colors';

/**
 * Records a split/partial delivery — "40 ordered, vendor delivers 10
 * now, 30 later." Each submission here adds to the purchase's running
 * delivered_quantity and creates that many new linked assets (see
 * purchaseController.recordPartialDelivery). Nothing about payment is
 * touched — Advance Payment already tracks money independently of how
 * many units have physically arrived.
 */
export default function RecordDeliveryModal({ purchase, onClose, onSubmit }) {
  const remaining = purchase.quantity - purchase.delivered_quantity;
  const [quantity, setQuantity] = useState(remaining);
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const qty = parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Enter a whole number greater than 0.');
      return;
    }
    if (qty > remaining) {
      setError(`Only ${remaining} unit(s) remain undelivered.`);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(purchase.id, { quantity_delivered: qty, delivery_date: deliveryDate });
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
              <Truck size={15} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Record Delivery</h2>
              <p className="text-xs text-slate-400">{purchase.item_name}</p>
            </div>
          </div>
          <button onClick={onClose} title="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {purchase.delivered_quantity} of {purchase.quantity} delivered so far — {remaining} remaining.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Quantity delivered now</label>
            <input type="number" min="1" max={remaining} className={FIELD_CLASS} value={quantity}
              onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Delivery date</label>
            <input type="date" className={FIELD_CLASS} value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)} />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-60">
              {submitting ? 'Saving…' : 'Confirm delivery'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
