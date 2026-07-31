import { useState, useMemo } from 'react';
import { X, ChevronDown, ChevronRight, Camera, FileText, ShieldCheck, Plus, Trash2, Sparkles, Loader2 } from 'lucide-react';
import FileDropZone from './FileDropZone.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/api.js';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

function blankItem() {
  return { item_name: '', description: '', quantity: 1, unit_cost: '', amount_paid: '' };
}

/**
 * "New Purchase" form.
 *  - Vendor AND delivery location are both free text with autocomplete
 *    suggestions (via <datalist>) — the backend looks up a match by
 *    name or creates a new record, so nothing has to be pre-registered.
 *  - Supports MULTIPLE line items under one purchase transaction from
 *    the same vendor (e.g. a chair, a table, and a hat in one order) —
 *    each row has its own Asset Name, PO Number, Quantity, and
 *    Amount/Cost. Vendor, delivery location, dates, and delivery
 *    status are shared across every line item since they describe the
 *    ORDER, not any one item. With exactly one row, submission behaves
 *    identically to the original single-item flow (POST /purchases);
 *    with more than one, it goes through POST /purchases/batch so the
 *    rows are grouped by a shared purchase_order_id — see
 *    App.jsx's handleCreatePurchase.
 *  - "Amount already paid" is per line item; total cost and the
 *    remaining balance are calculated live, summed across every item.
 *  - Insurance photos/invoices are OPTIONAL at creation time and,
 *    deliberately, uploaded as a SEPARATE follow-up call (onUploadFiles)
 *    AFTER the purchase itself is created (onSubmit) — never bundled
 *    into one request. This means a failed/rejected file (wrong type,
 *    over 10MB) can never block the purchase from being saved; the
 *    purchase creation success and the file upload outcome are
 *    reported to the user independently. For a multi-item order, files
 *    attach to the FIRST line item's record (there's no single
 *    natural "whole order" row to attach them to instead).
 *  - Invoices and insurance are separate entities: the invoice
 *    uploader is ALWAYS visible and usable regardless of whether
 *    "This asset is insured" is checked. Only the insurance PHOTOS
 *    picker is gated behind that toggle.
 */
export default function AddPurchaseModal({ vendors, locations, onClose, onSubmit, onUploadFiles }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    requested_by_name: user?.name || '',
    requested_by_phone: '',
    po_number: '',
    vendor_name: '',
    vendor_gst_number: '',
    vendor_address: '',
    vendor_phone: '',
    order_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: '',
    location_name: '',
    location_address: '',
    location_gst_number: '',
    is_delivered: false,
  });
  const [items, setItems] = useState([blankItem()]);

  // --- PO number generation (see utils/poNumber.js on the backend) ---
  // One PO number per ORDER (not per line item), built from the
  // delivery location's 3-letter code plus the next number in the one
  // global sequence shared across every location and both creation
  // flows. Regenerating after the location changes keeps the prefix
  // in sync; the number itself only ever moves forward.
  const [poGenerating, setPoGenerating] = useState(false);
  const [poLocationCode, setPoLocationCode] = useState('');
  const [poGeneratedFor, setPoGeneratedFor] = useState(''); // which location name the current po_number was generated for

  async function generatePoNumber(locationName) {
    const trimmed = (locationName ?? form.location_name).trim();
    if (!trimmed) {
      setError('Enter a delivery location first, then generate the PO number.');
      return;
    }
    setPoGenerating(true);
    try {
      const result = await api.getNextPoNumber(trimmed);
      setForm((f) => ({ ...f, po_number: result.po_number || '' }));
      setPoLocationCode(result.location_code || '');
      setPoGeneratedFor(trimmed);
    } catch (err) {
      setError(err.message || 'Could not generate a PO number.');
    } finally {
      setPoGenerating(false);
    }
  }

  function updateItem(index, field, value) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }
  function addItem() {
    setItems((rows) => [...rows, blankItem()]);
  }
  function removeItem(index) {
    setItems((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));
  }

  const [showVendorDetails, setShowVendorDetails] = useState(false);
  const [showLocationDetails, setShowLocationDetails] = useState(false);
  const [insured, setInsured] = useState(false);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [invoiceFiles, setInvoiceFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // --- Vendor autocomplete / smart auto-fill ---
  // Matches Vendor Management page's records so the "type a vendor name"
  // field can behave two ways: (1) an EXISTING vendor name auto-fills
  // its saved GST/address/phone instead of the user re-typing them
  // every time, (2) a brand-new name prompts a confirmation before it's
  // silently saved as a new vendor record on submit (findOrCreateVendor
  // on the backend would otherwise do this unconditionally).
  const [vendorConfirmed, setVendorConfirmed] = useState(true); // true = nothing new to confirm yet
  const [showNewVendorPrompt, setShowNewVendorPrompt] = useState(false);

  const matchedVendor = useMemo(() => {
    const typed = form.vendor_name.trim().toLowerCase();
    if (!typed) return null;
    return vendors?.find((v) => v.name.trim().toLowerCase() === typed) || null;
  }, [form.vendor_name, vendors]);

  function updateVendorName(value) {
    setForm((f) => ({ ...f, vendor_name: value }));
    setShowNewVendorPrompt(false);
    setVendorConfirmed(true); // re-armed on every keystroke; re-checked onBlur
  }

  function handleVendorNameBlur() {
    const typed = form.vendor_name.trim();
    if (!typed) return;
    const match = vendors?.find((v) => v.name.trim().toLowerCase() === typed.toLowerCase());
    if (match) {
      // Existing vendor selected/typed — auto-fill its saved details so
      // the admin doesn't have to look them up or re-type them.
      setForm((f) => ({
        ...f,
        vendor_name: match.name, // normalize casing to the saved record
        vendor_gst_number: match.gst_number || '',
        vendor_address: match.address || '',
        vendor_phone: match.contact_phone || '',
      }));
      setShowVendorDetails(true);
      setVendorConfirmed(true);
      setShowNewVendorPrompt(false);
    } else {
      // Unrecognized name — ask before it gets saved as a new vendor.
      setVendorConfirmed(false);
      setShowNewVendorPrompt(true);
    }
  }

  function confirmNewVendor() {
    setVendorConfirmed(true);
    setShowNewVendorPrompt(false);
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const totalCost = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0), 0),
    [items]
  );
  const totalPaid = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.amount_paid) || 0), 0),
    [items]
  );
  const remaining = Math.max(0, totalCost - totalPaid);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.requested_by_name.trim()) {
      setError("Your name is required.");
      return;
    }
    if (!form.requested_by_phone.trim()) {
      setError('Your phone number is required.');
      return;
    }
    if (!form.location_name.trim()) {
      setError('Delivery location is required.');
      return;
    }
    if (!form.po_number || poGeneratedFor.toLowerCase() !== form.location_name.trim().toLowerCase()) {
      setError('Click "Generate PO" for the current delivery location before submitting.');
      return;
    }

    if (!vendorConfirmed) {
      setShowNewVendorPrompt(true);
      setError(`Please confirm whether to save "${form.vendor_name.trim()}" as a new vendor before continuing.`);
      return;
    }

    for (let i = 0; i < items.length; i++) {
      if (!items[i].item_name.trim()) {
        setError(`Line item ${i + 1}: item name is required.`);
        return;
      }
    }

    setSubmitting(true);

    // One PO number applies to every line item in this order — see
    // generatePoNumber above.
    const itemsWithPo = items.map((it) => ({ ...it, po_number: form.po_number }));

    let created;
    try {
      created = await onSubmit({ ...form, items: itemsWithPo }); // throws + stays open on failure — nothing uploaded yet
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    // Purchase is saved at this point no matter what happens below —
    // file upload failures are reported by the parent (toast) rather
    // than reopening or blocking this modal. Invoices upload
    // independently of the insurance toggle; only insurance photos are
    // tied to it (there's nothing to upload there if not insured).
    if (created?.id && (photoFiles.length || invoiceFiles.length)) {
      try {
        await onUploadFiles(created.id, insured ? photoFiles : [], invoiceFiles);
      } catch {
        // onUploadFiles already surfaces its own error toast — no
        // further action needed here.
      }
    }

    setSubmitting(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">New Asset Purchase</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form id="new-purchase-form" onSubmit={handleSubmit} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {/* --- Requester + delivery location, asked FIRST so the PO
              number (which is built from the location) can be
              generated before anything else is filled in. --- */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Your name</label>
                <input required className={FIELD_CLASS} value={form.requested_by_name}
                  onChange={(e) => update('requested_by_name', e.target.value)} placeholder="Full name" title="Your name — required" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Your phone number</label>
                <input required type="tel" className={FIELD_CLASS} value={form.requested_by_phone}
                  onChange={(e) => update('requested_by_phone', e.target.value)} placeholder="10-digit number" title="Your phone number — required" />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-slate-500">Delivery location</label>
              <input
                required
                list="location-suggestions"
                className={FIELD_CLASS}
                value={form.location_name}
                onChange={(e) => update('location_name', e.target.value)}
                onBlur={() => { if (form.location_name.trim() && poGeneratedFor.toLowerCase() !== form.location_name.trim().toLowerCase()) generatePoNumber(); }}
                placeholder="e.g. Kolkata, Mumbai HQ — new or existing"
                title="Delivery location — type an existing one or a new one"
              />
              <datalist id="location-suggestions">
                {locations?.map((l) => <option key={l.id} value={l.name} />)}
              </datalist>

              <button type="button" onClick={() => setShowLocationDetails((s) => !s)}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                title="Optionally record this location's address and GST number">
                {showLocationDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Add address &amp; GST number
              </button>

              {showLocationDetails && (
                <div className="mt-2 space-y-2">
                  <input className={FIELD_CLASS} value={form.location_address}
                    onChange={(e) => update('location_address', e.target.value)} placeholder="Address" />
                  <input className={FIELD_CLASS} value={form.location_gst_number}
                    onChange={(e) => update('location_gst_number', e.target.value)} placeholder="GST number" />
                </div>
              )}
            </div>

            {/* --- PO number: generated from the location above, e.g.
                Kolkata -> po_kol_01, then Delhi -> po_del_02 — one
                global sequence shared by every location and both
                creation flows (New Asset Purchase + Inventory's New
                Asset). --- */}
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-500">PO number</label>
                <input readOnly className={`${FIELD_CLASS} bg-slate-100 font-mono text-slate-700`}
                  value={form.po_number} placeholder="Generate from the location above"
                  title="PO number — generated automatically from the delivery location" />
              </div>
              <button
                type="button"
                onClick={() => generatePoNumber()}
                disabled={poGenerating || !form.location_name.trim()}
                title="Generate the PO number for this location"
                className="mt-5 flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {poGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Generate PO
              </button>
            </div>
            {poLocationCode && form.po_number && (
              <p className="mt-1.5 text-xs text-slate-500">
                Location code <span className="font-mono font-medium text-slate-700">{poLocationCode}</span> — this number is next in the global PO sequence.
              </p>
            )}
          </div>

          {/* --- Line items: one or more assets bought together in this
              same order. A single row behaves exactly like the original
              single-item form; adding rows switches submission to the
              multi-item batch endpoint (see handleSubmit / App.jsx). --- */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-500">
                {items.length > 1 ? `Line items (${items.length})` : 'Item details'}
              </label>
              <button type="button" onClick={addItem}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                <Plus size={13} /> Add another item
              </button>
            </div>

            {items.map((item, index) => (
              <div key={index} className="rounded-lg border border-slate-200 p-3">
                {items.length > 1 && (
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">Item {index + 1}</span>
                    <button type="button" onClick={() => removeItem(index)}
                      className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700">
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Item name</label>
                  <input required className={FIELD_CLASS} value={item.item_name}
                    onChange={(e) => updateItem(index, 'item_name', e.target.value)} placeholder="e.g. Dell Latitude 5440" />
                </div>

                <div className="mt-2">
                  <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
                  <input className={FIELD_CLASS} value={item.description}
                    onChange={(e) => updateItem(index, 'description', e.target.value)} placeholder="Optional" />
                </div>

                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Quantity</label>
                    <input required type="number" min="1" className={FIELD_CLASS} value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Unit cost (₹)</label>
                    <input required type="number" min="0" step="0.01" className={FIELD_CLASS} value={item.unit_cost}
                      onChange={(e) => updateItem(index, 'unit_cost', e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Paid (₹)</label>
                    <input type="number" min="0" step="0.01" className={FIELD_CLASS} value={item.amount_paid}
                      onChange={(e) => updateItem(index, 'amount_paid', e.target.value)} placeholder="0" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* --- Vendor (shared across every line item — one order, one vendor) --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">Vendor</label>
            <input
              required
              list="vendor-suggestions"
              className={FIELD_CLASS}
              value={form.vendor_name}
              onChange={(e) => updateVendorName(e.target.value)}
              onBlur={handleVendorNameBlur}
              placeholder="Type a vendor name — new or existing"
            />
            <datalist id="vendor-suggestions">
              {vendors?.map((v) => <option key={v.id} value={v.name} />)}
            </datalist>

            {matchedVendor && (
              <p className="mt-1.5 text-xs text-green-700">
                Matched existing vendor — GST, address &amp; phone auto-filled below.
              </p>
            )}

            {showNewVendorPrompt && !matchedVendor && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-800">
                  "{form.vendor_name.trim()}" isn't in Vendor Management yet. Save it as a new vendor?
                </p>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={confirmNewVendor}
                    className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700">
                    Yes, save
                  </button>
                  <button type="button" onClick={() => setShowNewVendorPrompt(false)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
                    Edit name
                  </button>
                </div>
              </div>
            )}

            <button type="button" onClick={() => setShowVendorDetails((s) => !s)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              {showVendorDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Add GST, address &amp; phone
            </button>

            {showVendorDetails && (
              <div className="mt-2 space-y-2">
                <input className={FIELD_CLASS} value={form.vendor_gst_number}
                  onChange={(e) => update('vendor_gst_number', e.target.value)} placeholder="GST number" />
                <input className={FIELD_CLASS} value={form.vendor_address}
                  onChange={(e) => update('vendor_address', e.target.value)} placeholder="Address" />
                <input type="tel" className={FIELD_CLASS} value={form.vendor_phone}
                  onChange={(e) => update('vendor_phone', e.target.value)} placeholder="Phone number" />
              </div>
            )}
          </div>

          {/* Live calculation — updates as any line item's quantity / unit
              cost / amount paid changes, summed across all items */}
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Total cost{items.length > 1 ? ` (${items.length} items)` : ''}</span>
              <span className="font-mono tabular-nums text-slate-800">{currency(totalCost)}</span>
            </div>
            <div className="mt-1 flex justify-between text-slate-500">
              <span>Total paid so far</span>
              <span className="font-mono tabular-nums text-slate-800">{currency(totalPaid)}</span>
            </div>
            <div className="mt-1 flex justify-between text-slate-500">
              <span>Remaining balance</span>
              <span className={`font-mono tabular-nums ${remaining > 0 ? 'text-red-700' : 'text-green-700'}`}>
                {currency(remaining)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Purchase date</label>
              <input type="date" className={FIELD_CLASS} value={form.order_date}
                onChange={(e) => update('order_date', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Expected delivery date</label>
              <input type="date" className={FIELD_CLASS} value={form.expected_delivery_date}
                onChange={(e) => update('expected_delivery_date', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Delivery Status</label>
            <div className="mt-1 flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="radio" name="delivery_status" checked={!form.is_delivered} onChange={() => update('is_delivered', false)} className="text-brand-600 focus:ring-brand-500" />
                Delivery Pending
              </label>
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="radio" name="delivery_status" checked={form.is_delivered} onChange={() => update('is_delivered', true)} className="text-brand-600 focus:ring-brand-500" />
                Already Delivered
              </label>
            </div>
          </div>

          {/* --- Insurance (photos only) --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <ShieldCheck size={14} className="text-slate-400" /> This asset is insured
            </label>

            {insured && (
              <div className="mt-3">
                <FileDropZone
                  icon={Camera} label="Insurance photos" accept="image/jpeg,image/png,application/pdf"
                  hint="JPEG, PNG, or PDF, up to 10MB each"
                  files={photoFiles} onChange={setPhotoFiles}
                />
              </div>
            )}
          </div>

          {/* --- Invoices: a separate entity from insurance, so this is
              ALWAYS visible and usable regardless of the toggle above. --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm text-slate-700">
              <FileText size={14} className="text-slate-400" /> Invoice files
            </p>
            <FileDropZone
              icon={FileText} label="Invoice files" accept="image/jpeg,image/png,application/pdf"
              hint="JPEG, PNG, or PDF, up to 10MB each — uploaded after the purchase is created"
              files={invoiceFiles} onChange={setInvoiceFiles}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            Cancel
          </button>
          <button type="submit" form="new-purchase-form" disabled={submitting}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-60">
            {submitting ? 'Saving…' : 'Create Purchase'}
          </button>
        </div>
      </div>
    </div>
  );
}

