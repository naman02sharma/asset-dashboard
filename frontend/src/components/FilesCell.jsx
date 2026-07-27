import { useState } from 'react';
import { ShieldCheck, ShieldOff, Camera, FileText } from 'lucide-react';
import FileUploadModal from './FileUploadModal.jsx';

/**
 * Compact file control rendered inline in each table row:
 *  - A toggle pill for "Insured" / "Not insured" (PATCH .../insurance).
 *    Turning it off deletes ALL uploaded insurance PHOTOS server-side
 *    too — but it never touches invoices, since invoices are a
 *    separate concept from insurance and must always stay available
 *    regardless of the insurance toggle.
 *  - "Photos" (insurance proof) only appears once insured — that one
 *    genuinely depends on the toggle.
 *  - "Invoices" is ALWAYS visible and uploadable, insured or not.
 *  - Clicking either file group opens a centered upload modal (see
 *    FileUploadModal) instead of the old cramped corner popover, which
 *    used to get clipped by the table's horizontal scroll container.
 */
export default function FilesCell({ purchase, onToggleInsurance, onUploadPhotos, onUploadInvoices, onDeleteFile }) {
  const [toggling, setToggling] = useState(false);
  const [openGroup, setOpenGroup] = useState(null); // 'photos' | 'invoices' | null

  async function handleToggle() {
    setToggling(true);
    try {
      await onToggleInsurance(purchase.id, !purchase.insurance_done);
    } finally {
      setToggling(false);
    }
  }

  const photoCount = purchase.insurance_photos?.length || 0;
  const invoiceCount = purchase.invoices?.length || 0;

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleToggle}
        disabled={toggling}
        title={purchase.insurance_done ? 'Mark as not insured' : 'Mark as insured'}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
          purchase.insurance_done
            ? 'bg-green-50 text-green-700 hover:bg-green-100'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
        }`}
      >
        {purchase.insurance_done ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
        {purchase.insurance_done ? 'Insured' : 'Not insured'}
      </button>

      {purchase.insurance_done && (
        <FileGroupButton icon={Camera} label="Photos" count={photoCount} onClick={() => setOpenGroup('photos')} />
      )}

      {/* Invoices are a separate entity from insurance and are ALWAYS
          available, regardless of the insurance toggle above. */}
      <FileGroupButton icon={FileText} label="Invoices" count={invoiceCount} onClick={() => setOpenGroup('invoices')} />

      {openGroup === 'photos' && (
        <FileUploadModal
          label="Insurance photos" icon={Camera} accept="image/jpeg,image/png,application/pdf"
          hint="JPEG, PNG, or PDF, up to 10MB each"
          files={purchase.insurance_photos || []}
          recordId={purchase.id}
          onUpload={(id, files, onProgress) => onUploadPhotos(id, files, onProgress)}
          onDelete={onDeleteFile}
          onClose={() => setOpenGroup(null)}
        />
      )}

      {openGroup === 'invoices' && (
        <FileUploadModal
          label="Invoices" icon={FileText} accept="image/jpeg,image/png,application/pdf"
          hint="JPEG, PNG, or PDF, up to 10MB each"
          files={purchase.invoices || []}
          recordId={purchase.id}
          onUpload={(id, files, onProgress) => onUploadInvoices(id, files, onProgress)}
          onDelete={onDeleteFile}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </div>
  );
}

function FileGroupButton({ icon: Icon, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} (${count})`}
      className={`relative flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
        count
          ? 'bg-green-50 text-green-600 hover:bg-green-100'
          : 'border border-dashed border-slate-300 text-slate-400 hover:border-brand-400 hover:text-brand-600'
      }`}
    >
      <Icon size={13} />
      {count > 0 && (
        <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-600 text-[9px] font-semibold text-white">
          {count}
        </span>
      )}
    </button>
  );
}
