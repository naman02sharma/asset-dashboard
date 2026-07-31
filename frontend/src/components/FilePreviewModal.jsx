import { useEffect, useState } from 'react';
import { X, ExternalLink, FileQuestion, AlertTriangle } from 'lucide-react';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const PDF_EXT = /\.pdf$/i;

/**
 * Centered preview for a single uploaded file — used anywhere a file
 * list currently just links out ("open in new tab"): insurance
 * photos/invoices (FileUploadModal), AMC contracts/invoices
 * (AssetDetailDrawer), completed-order attachments. Detects
 * image/PDF purely from the filename extension (no backend change
 * needed — original_name already carries the extension) and falls
 * back to an "open in new tab" prompt for anything else (docx, etc.)
 * rather than showing a broken embed.
 */
export default function FilePreviewModal({ file, onClose }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const name = file.name || 'file';
  const isImage = IMAGE_EXT.test(name);
  const isPdf = PDF_EXT.test(name);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="truncate text-sm font-medium text-slate-700">{name}</p>
          <div className="flex items-center gap-1">
            <a href={file.url} target="_blank" rel="noreferrer" title="Open in new tab"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600 hover:scale-105 transition-all">
              <ExternalLink size={15} />
            </a>
            <button onClick={onClose} title="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 hover:scale-105 transition-all">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-50 p-3">
          {isImage && !imageFailed && (
            <img src={file.url} alt={name} onError={() => setImageFailed(true)}
              className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-sm" />
          )}
          {isImage && imageFailed && (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-slate-400">
              <AlertTriangle size={32} className="text-amber-500" />
              <p className="text-sm">This file couldn't be loaded — it may have been moved or deleted on the server.</p>
            </div>
          )}
          {isPdf && (
            <iframe title={name} src={file.url} className="h-[75vh] w-full rounded-lg border border-slate-200 bg-white" />
          )}
          {!isImage && !isPdf && (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-slate-400">
              <FileQuestion size={32} />
              <p className="text-sm">No inline preview for this file type.</p>
              <a href={file.url} target="_blank" rel="noreferrer"
                className="mt-1 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:from-brand-600 hover:to-brand-700 transition-all active:scale-95">
                Open in new tab
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
