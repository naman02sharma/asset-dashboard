import { useEffect, useRef, useState } from 'react';
import { X, Pencil, User, Wrench, History, FileText, Plus, Loader2, Check, QrCode } from 'lucide-react';
import { api } from '../api/api.js';
import FilePreviewModal from './FilePreviewModal.jsx';
import QrCodeModal from './QrCodeModal.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const currency = (n) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const FIELD_LABELS = {
  asset_name: 'Asset name', category: 'Category', serial_number: 'Serial number', model_number: 'Model number', vendor_id: 'Vendor',
  asset_tag: 'Asset tag', location: 'Location',
  purchase_date: 'Purchase date', cost: 'Cost', warranty_expiry: 'Warranty expiry', useful_life_years: 'Useful life (years)',
  amc_provider: 'AMC provider', amc_start_date: 'AMC start date', amc_end_date: 'AMC end date', amc_cost: 'AMC cost',
  status: 'Status',
};

/**
 * Slide-over detail panel for one asset: core/AMC info with an Edit
 * trigger, AMC contract/invoice uploads, and the merged History/Trail
 * timeline — every holding (assignment or repair dispatch) PLUS every
 * field-level edit, sorted into one chronological feed. Nothing here
 * is ever deleted or overwritten by a re-assignment; this view is
 * purely additive, reading the append-only log.
 */
export default function AssetDetailDrawer({ assetId, onClose, onEdit, showToast, onAssetChanged }) {
  const { canEdit } = useAuth();
  const [data, setData] = useState(null); // { asset, holdings, changeLog }
  const [showQr, setShowQr] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const detail = await api.getAssetDetail(assetId);
      setData(detail);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [assetId]);

  function handleFilesUpdated(updatedAsset) {
    setData((d) => ({ ...d, asset: updatedAsset }));
    onAssetChanged?.(updatedAsset);
  }

  const timeline = data ? buildTimeline(data.holdings, data.changeLog) : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{data?.asset?.asset_name || 'Asset'}</h2>
          <div className="flex items-center gap-2">
            {data && (
              <button onClick={() => setShowQr(true)} title="Show QR code"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:scale-105 hover:bg-slate-100 hover:text-brand-600">
                <QrCode size={14} />
              </button>
            )}
            {data && canEdit && (
              <button onClick={() => onEdit(data.asset)} title="Edit asset"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:scale-105 hover:bg-slate-100 hover:text-brand-600">
                <Pencil size={14} />
              </button>
            )}
            <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
        </div>

        {loading && <div className="flex flex-1 items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={20} /></div>}

        {!loading && data && (
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* Core info */}
            <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label="Category" value={data.asset.category} />
              <Field label="Serial number" value={data.asset.serial_number} />
              <Field label="Model number" value={data.asset.model_number} />
              <Field label="Asset tag" value={data.asset.asset_tag} />
              <Field label="Location" value={data.asset.location} />
              <Field label="Vendor" value={data.asset.vendor_name} />
              <Field label="Purchase date" value={dateFmt(data.asset.purchase_date)} />
              <Field label="Cost" value={currency(data.asset.cost)} />
              <Field label="Warranty expiry" value={dateFmt(data.asset.warranty_expiry)} />
              {data.asset.useful_life_years && (
                <Field label="Current book value"
                  value={`${currency(data.asset.current_book_value)} (of ${data.asset.useful_life_years}yr life)`} />
              )}
            </section>

            {/* AMC */}
            <section className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-xs font-medium text-slate-500">AMC (Annual Maintenance Contract)</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label="Provider" value={data.asset.amc_provider} />
                <Field label="Cost" value={currency(data.asset.amc_cost)} />
                <Field label="Start date" value={dateFmt(data.asset.amc_start_date)} />
                <Field label="End date" value={dateFmt(data.asset.amc_end_date)} />
              </div>

              <div className="mt-3 flex gap-4">
                <AmcFileGroup label="Contracts" icon={FileText} files={data.asset.amc_contracts || []}
                  onUpload={(files) => api.uploadAmcContracts(assetId, files)}
                  onUpdated={handleFilesUpdated} assetId={assetId} showToast={showToast} />
                <AmcFileGroup label="Invoices" icon={FileText} files={data.asset.amc_invoices || []}
                  onUpload={(files) => api.uploadAmcInvoices(assetId, files)}
                  onUpdated={handleFilesUpdated} assetId={assetId} showToast={showToast} />
              </div>
            </section>

            {/* History / Trail timeline */}
            <section>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <History size={13} /> History / Trail
              </p>
              {timeline.length === 0 && <p className="text-sm text-slate-400">No activity logged yet.</p>}
              <ol className="space-y-1">
                {timeline.map((entry) => (
                  <li key={entry.key} className="relative flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50">
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${entry.dotClass}`}>
                      <entry.icon size={11} className="text-white" />
                    </span>
                    <div className="min-w-0 flex-1 pb-1">
                      <p className="text-sm leading-snug text-slate-700">{entry.text}</p>
                      <p className="text-xs text-slate-400">{entry.dateLabel}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </div>

      {showQr && data && <QrCodeModal asset={data.asset} onClose={() => setShowQr(false)} />}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-slate-700">{value || '—'}</p>
    </div>
  );
}

/**
 * Merges asset_holdings (custody changes) and asset_change_log (field
 * edits) into one chronologically-sorted feed for the timeline.
 */
function buildTimeline(holdings, changeLog) {
  const entries = [];

  for (const h of holdings) {
    const isEmployee = h.holder_type === 'employee';
    const who = isEmployee ? h.employee_name_snapshot : h.repair_vendor_name;
    const range = `${dateFmt(h.started_at)} – ${h.returned_at ? dateFmt(h.returned_at) : 'Present'}`;
    let text = isEmployee ? `Assigned to ${who}: ${range}` : `Sent to ${who || 'vendor'} for Repair: ${range}`;
    // department_snapshot/location_name_snapshot are captured at the
    // moment of assignment (see migration 020) -- shown here as-is
    // rather than looked up live, so this line stays accurate even if
    // the employee's own profile changes later.
    if (isEmployee && (h.department_snapshot || h.location_name_snapshot)) {
      const bits = [h.department_snapshot, h.location_name_snapshot].filter(Boolean);
      text += ` (${bits.join(', ')})`;
    }
    if (h.returned_at && h.condition_note) text += ` (${h.condition_note})`;
    entries.push({
      key: `h-${h.id}`,
      sortDate: h.started_at,
      text,
      dateLabel: h.returned_at ? `Returned ${dateFmt(h.returned_at)}` : 'Ongoing',
      icon: isEmployee ? User : Wrench,
      dotClass: isEmployee ? 'bg-blue-500' : 'bg-amber-500',
    });
  }

  for (const c of changeLog) {
    const label = FIELD_LABELS[c.field_name] || c.field_name;
    entries.push({
      key: `c-${c.id}`,
      sortDate: c.changed_at,
      text: `${label} changed: "${c.previous_value ?? '—'}" → "${c.new_value ?? '—'}"`,
      dateLabel: new Date(c.changed_at).toLocaleString('en-IN'),
      icon: Pencil,
      dotClass: 'bg-slate-400',
    });
  }

  return entries.sort((a, b) => (a.sortDate < b.sortDate ? 1 : -1));
}

function AmcFileGroup({ label, icon: Icon, files, onUpload, onUpdated, showToast }) {
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const inputRef = useRef(null);

  async function handleFilesSelected(e) {
    const selected = Array.from(e.target.files || []);
    e.target.value = '';
    if (!selected.length) return;
    setUploading(true);
    try {
      const result = await onUpload(selected);
      onUpdated(result.asset);
      const failed = result.results.filter((r) => !r.success);
      if (failed.length) showToast(`${failed.length} file(s) failed to upload.`, 'error');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex-1">
      <p className="mb-1 text-[11px] text-slate-400">{label} ({files.length})</p>
      <div className="flex flex-wrap gap-1.5">
        {files.map((f) => (
          <button key={f.id} type="button" onClick={() => setPreviewFile(f)}
            className="flex items-center gap-1 rounded border border-slate-200 px-1.5 py-1 text-[11px] text-brand-600 hover:bg-brand-50">
            <Check size={10} /> {f.name || 'file'}
          </button>
        ))}
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-1 text-[11px] text-slate-500 hover:border-brand-400 hover:text-brand-600 disabled:opacity-50">
          {uploading ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Add
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,application/pdf" multiple className="hidden" onChange={handleFilesSelected} />
      </div>
      {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}
