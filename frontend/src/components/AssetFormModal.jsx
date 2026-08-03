import { useState, useMemo } from 'react';
import { X, ChevronDown, ChevronRight, Sparkles, Loader2, Pencil, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/api.js';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/**
 * Create or edit an inventory item's core purchase details and AMC
 * fields. In edit mode, every changed field gets logged to that
 * asset's History/Trail automatically by the backend (updateAsset) —
 * this form doesn't need to know or do anything special about that.
 */
export default function AssetFormModal({ mode = 'create', asset, vendors, locations, onClose, onSubmit }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    requested_by_name: mode === 'create' ? (user?.name || '') : '',
    requested_by_phone: '',
    po_number: asset?.po_number || '',
    asset_name: asset?.asset_name || '',
    category: asset?.category || '',
    serial_number: asset?.serial_number || '',
    model_number: asset?.model_number || '',
    asset_tag: asset?.asset_tag || '',
    location_name: asset?.location_name || asset?.location || '',
    location_address: asset?.location_address || '',
    location_gst_number: asset?.location_gst_number || '',
    vendor_name: asset?.vendor_name || '',
    vendor_gst_number: asset?.vendor_gst_number || '',
    vendor_address: asset?.vendor_address || '',
    vendor_phone: asset?.vendor_phone || '',
    purchase_date: asset?.purchase_date || '',
    cost: asset?.cost ?? '',
    tax_percent: asset?.tax_percent ?? '',
    warranty_expiry: asset?.warranty_expiry || '',
    useful_life_years: asset?.useful_life_years || '',
    amc_provider: asset?.amc_provider || '',
    amc_start_date: asset?.amc_start_date || '',
    amc_end_date: asset?.amc_end_date || '',
    amc_cost: asset?.amc_cost ?? '',
  });
  const [showAmc, setShowAmc] = useState(!!asset?.amc_provider);
  const [showVendorDetails, setShowVendorDetails] = useState(false);
  const [showLocationDetails, setShowLocationDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // --- PO number generation — create mode only (see AddPurchaseModal
  // for the New Asset Purchase equivalent; both call the same backend
  // preview endpoint, GET /purchases/next-po, so the two flows share
  // the SAME global sequence). ---
  const [poGenerating, setPoGenerating] = useState(false);
  const [poLocationCode, setPoLocationCode] = useState('');
  const [poGeneratedFor, setPoGeneratedFor] = useState('');
  const [poEditable, setPoEditable] = useState(false); // true while the user is manually typing a PO number instead of using the generated one
  const [poManualOverride, setPoManualOverride] = useState(false); // true once the user has actually hand-edited the generated value

  async function generatePoNumber(locationName) {
    const trimmed = (locationName ?? form.location_name).trim();
    if (!trimmed) {
      setError('Enter a location first, then generate the PO number.');
      return;
    }
    setPoGenerating(true);
    try {
      const result = await api.getNextPoNumber(trimmed);
      setForm((f) => ({ ...f, po_number: result.po_number || '' }));
      setPoLocationCode(result.location_code || '');
      setPoGeneratedFor(trimmed);
      setPoManualOverride(false);
      setPoEditable(false);
    } catch (err) {
      setError(err.message || 'Could not generate a PO number.');
    } finally {
      setPoGenerating(false);
    }
  }

  // Manual edit: user types a PO number themselves instead of accepting
  // the auto-generated one. Bypasses the "must match the current
  // location" generation check on submit, but the field still can't be
  // left blank.
  function updatePoNumberManually(value) {
    setForm((f) => ({ ...f, po_number: value }));
    setPoManualOverride(true);
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const costWithTax = useMemo(() => {
    const cost = Number(form.cost) || 0;
    const taxPct = Number(form.tax_percent) || 0;
    return cost * (1 + taxPct / 100);
  }, [form.cost, form.tax_percent]);

  // Uniformity fix: matches the same "fill in blanks only" autofill
  // AddPurchaseModal/EditPurchaseModal do for their own vendor fields —
  // this form had a vendor datalist but never looked the typed name up
  // against the vendor list at all.
  function handleVendorNameBlur() {
    const typed = form.vendor_name.trim();
    if (!typed) return;
    const match = vendors?.find((v) => v.name.trim().toLowerCase() === typed.toLowerCase());
    if (match) {
      setForm((f) => ({
        ...f,
        vendor_gst_number: f.vendor_gst_number || match.gst_number || '',
        vendor_address: f.vendor_address || match.address || '',
        vendor_phone: f.vendor_phone || match.contact_phone || '',
      }));
      if (match.gst_number || match.address || match.contact_phone) setShowVendorDetails(true);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (mode === 'create') {
      if (!form.requested_by_name.trim()) {
        setError('Your name is required.');
        return;
      }
      if (!form.requested_by_phone.trim()) {
        setError('Your phone number is required.');
        return;
      }
      if (!form.location_name.trim()) {
        setError('Location is required.');
        return;
      }
      if (!form.po_number.trim()) {
        setError('Enter or generate a PO number before submitting.');
        return;
      }
      if (!poManualOverride && poGeneratedFor.toLowerCase() !== form.location_name.trim().toLowerCase()) {
        setError('Click "Generate PO" for the current location before submitting.');
        return;
      }
    }

    // Client-side mirror of the backend's AMC date-order check — catches
    // the mistake before a round trip instead of only after.
    if (form.amc_start_date && form.amc_end_date && form.amc_end_date < form.amc_start_date) {
      setError('AMC End Date cannot be earlier than AMC Start Date.');
      return;
    }

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
          <h2 className="text-lg font-semibold text-slate-900">{mode === 'create' ? 'New Asset' : 'Edit Asset'}</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <form id="asset-form" onSubmit={handleSubmit} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {/* --- Requester + location, asked FIRST (create mode only —
              see AddPurchaseModal for the New Asset Purchase equivalent).
              The PO number is built from the location below, so location
              has to be entered before it can be generated. --- */}
          {mode === 'create' && (
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
          )}

          <div className="rounded-lg border border-slate-200 p-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">Location</label>
            <input
              required={mode === 'create'}
              list="asset-location-suggestions"
              className={FIELD_CLASS}
              value={form.location_name}
              onChange={(e) => update('location_name', e.target.value)}
              onBlur={() => {
                if (mode === 'create' && form.location_name.trim() && poGeneratedFor.toLowerCase() !== form.location_name.trim().toLowerCase()) generatePoNumber();
              }}
              placeholder="e.g. HO – 3rd Floor — new or existing"
              title="Location — type an existing one or a new one"
            />
            {/* BUGFIX (uniformity audit): this field used to be plain
                free text with no autocomplete at all — every other
                location field in the app (Asset Purchase form's New/
                Edit Purchase modals) suggests from the shared
                locations list; `locations` simply wasn't being passed
                down this far (App -> AssetLifecyclePage stopped at
                CompletedOrdersPage, never reached InventoryPage). */}
            <datalist id="asset-location-suggestions">
              {locations?.map((l) => <option key={l.id} value={l.name} />)}
            </datalist>
            <button type="button" onClick={() => setShowLocationDetails((s) => !s)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              title="Optionally record this location's address and GST number">
              {showLocationDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Add location details
            </button>
            {showLocationDetails && (
              <div className="mt-2 space-y-2">
                <input className={FIELD_CLASS} value={form.location_address}
                  onChange={(e) => update('location_address', e.target.value)} placeholder="Address" />
                <input className={FIELD_CLASS} value={form.location_gst_number}
                  onChange={(e) => update('location_gst_number', e.target.value)} placeholder="GST number" />
              </div>
            )}

            {mode === 'create' && (
              <>
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-slate-500">PO number</label>
                    <input
                      readOnly={!poEditable}
                      className={`${FIELD_CLASS} font-mono text-slate-700 ${poEditable ? '' : 'bg-slate-100'}`}
                      value={form.po_number}
                      onChange={(e) => updatePoNumberManually(e.target.value)}
                      placeholder="Generate from the location above, or edit manually"
                      title={poEditable ? 'Type a custom PO number' : 'PO number — generated automatically from the location'}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setPoEditable((v) => !v)}
                    title={poEditable ? 'Done editing' : 'Manually edit the PO number'}
                    className="mt-5 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all active:scale-95"
                  >
                    {poEditable ? <Check size={14} /> : <Pencil size={14} />}
                    {poEditable ? 'Done' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => generatePoNumber()}
                    disabled={poGenerating || !form.location_name.trim()}
                    title="Generate the PO number for this location"
                    className="mt-5 flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3 py-2 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-700 transition-all disabled:opacity-50 active:scale-95"
                  >
                    {poGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Generate PO
                  </button>
                </div>
                {poManualOverride ? (
                  <p className="mt-1.5 text-xs text-amber-600">
                    Manually entered — not checked against the auto-generated sequence.
                  </p>
                ) : poLocationCode && form.po_number && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Location code <span className="font-mono font-medium text-slate-700">{poLocationCode}</span> — this number is next in the global PO sequence.
                  </p>
                )}
              </>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Asset name</label>
            <input required className={FIELD_CLASS} value={form.asset_name}
              onChange={(e) => update('asset_name', e.target.value)} placeholder="e.g. Dell Latitude 5440 (SN: XJ2201)" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Category</label>
            <input className={FIELD_CLASS} value={form.category}
              onChange={(e) => update('category', e.target.value)} placeholder="e.g. Laptop" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Serial number</label>
              <input className={FIELD_CLASS} value={form.serial_number}
                onChange={(e) => update('serial_number', e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Model number</label>
              <input className={FIELD_CLASS} value={form.model_number}
                onChange={(e) => update('model_number', e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-slate-400">Fill in either one — serial number, model number, or both, whichever is on the label.</p>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Asset tag</label>
            <input className={FIELD_CLASS} value={form.asset_tag}
              onChange={(e) => update('asset_tag', e.target.value)} placeholder="e.g. IT-2026-014" />
            <p className="mt-0.5 text-[11px] text-slate-400">Your own tracking code for physical tagging/scanning — must be unique.</p>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">Vendor</label>
            <input list="asset-vendor-suggestions" className={FIELD_CLASS} value={form.vendor_name}
              onChange={(e) => update('vendor_name', e.target.value)} onBlur={handleVendorNameBlur}
              placeholder="Type a vendor name — new or existing" />
            <datalist id="asset-vendor-suggestions">
              {vendors?.map((v) => <option key={v.id} value={v.name} />)}
            </datalist>

            <button type="button" onClick={() => setShowVendorDetails((s) => !s)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              {showVendorDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Add GST, address & phone
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Purchase date</label>
              <input type="date" className={FIELD_CLASS} value={form.purchase_date}
                onChange={(e) => update('purchase_date', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Cost (₹)</label>
              <input type="number" min="0" step="0.01" className={FIELD_CLASS} value={form.cost}
                onChange={(e) => update('cost', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Tax (%)</label>
              <input type="number" min="0" step="0.01" className={FIELD_CLASS} value={form.tax_percent}
                onChange={(e) => update('tax_percent', e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex flex-col justify-end pb-2 text-right">
              {Number(form.tax_percent) > 0 && (
                <p className="text-[11px] text-slate-400">
                  Cost incl. tax: <span className="font-mono text-slate-600">{currency(costWithTax)}</span>
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Warranty expiry</label>
              <input type="date" className={FIELD_CLASS} value={form.warranty_expiry}
                onChange={(e) => update('warranty_expiry', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Useful life (years)</label>
              <input type="number" min="1" step="1" className={FIELD_CLASS} value={form.useful_life_years}
                onChange={(e) => update('useful_life_years', e.target.value)} placeholder="Optional" />
              <p className="mt-0.5 text-[11px] text-slate-400">Leave blank to skip depreciation tracking for this asset.</p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <button type="button" onClick={() => setShowAmc((s) => !s)}
              className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              {showAmc ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              AMC (Annual Maintenance Contract) details
            </button>

            {showAmc && (
              <div className="mt-2 space-y-2">
                <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-500">
                  An AMC (Annual Maintenance Contract) is a paid agreement with a
                  vendor to service/repair this asset for a fixed period — enter
                  who the provider is, the contract's start/end dates, and its
                  cost. Once <strong>End date</strong> is within 30 days, this
                  asset is automatically flagged "AMC expiring" on the Inventory
                  list and stat strip, so renewal doesn't get missed.
                </p>
                <input className={FIELD_CLASS} value={form.amc_provider}
                  onChange={(e) => update('amc_provider', e.target.value)} placeholder="AMC provider" />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-0.5 block text-[11px] text-slate-400">Start date</label>
                    <input type="date" className={FIELD_CLASS} value={form.amc_start_date}
                      onChange={(e) => update('amc_start_date', e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] text-slate-400">End date</label>
                    <input type="date" className={FIELD_CLASS} value={form.amc_end_date}
                      min={form.amc_start_date || undefined}
                      onChange={(e) => update('amc_end_date', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">AMC cost (₹)</label>
                  <input type="number" min="0" step="0.01" className={`${FIELD_CLASS} w-32`} value={form.amc_cost}
                    onChange={(e) => update('amc_cost', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" form="asset-form" disabled={submitting}
            className="rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-700 disabled:opacity-60 active:scale-95 transition-all">
            {submitting ? 'Saving…' : mode === 'create' ? 'Create Asset' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
