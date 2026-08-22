import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, FileQuestion, AlertTriangle, Download, Printer } from 'lucide-react';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const PDF_EXT = /\.pdf$/i;

/**
 * Centered preview for a single uploaded file — used anywhere a file
 * list currently just links out ("open in new tab"): insurance
 * photos/invoices (FileUploadModal), AMC contracts/invoices
 * (AssetDetailDrawer), completed-order attachments, and now Inventory's
 * per-asset documents too. Detects image/PDF purely from the filename
 * extension (no backend change needed — original_name already carries
 * the extension) and falls back to an "open in new tab" prompt for
 * anything else (docx, etc.) rather than showing a broken embed.
 *
 * Sized to stay a comfortable middle ground on any screen — never
 * edge-to-edge, never a tiny box: max-w-3xl (~48rem) capped at 90% of
 * viewport height, so it's the same "decent size" regardless of where
 * it's opened from.
 *
 * Carries its own Download and Print actions so this is a real
 * destination for viewing insurance/invoice documents, not a dead end
 * that still forces a trip to a new browser tab to do either.
 *
 * Portaled straight to document.body (see the matching comment on
 * FileUploadModal, which this is almost always nested inside of) —
 * without that, a `position: fixed` modal rendered from a table row
 * with its own hover transform (e.g. Order History's
 * `hover:-translate-y-0.5` row styling) stops being positioned
 * relative to the viewport and instead jumps around relative to that
 * row, which is what caused this to visibly flicker there. Portaling
 * makes this behave identically wherever it's opened from — Order
 * History, Inventory, or anywhere else.
 */
export default function FilePreviewModal({ file, onClose }) {
  const [imageFailed, setImageFailed] = useState(false);
  const printFrameRef = useRef(null);

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

  // Clean up any print iframe left over if the modal closes mid-print.
  useEffect(() => () => {
    if (printFrameRef.current) {
      printFrameRef.current.remove();
      printFrameRef.current = null;
    }
  }, []);

  const name = file.name || 'file';
  const isImage = IMAGE_EXT.test(name);
  const isPdf = PDF_EXT.test(name);
  const canPrint = isImage || isPdf;

  /**
   * Prints via a hidden iframe pointed straight at the file URL,
   * rather than window.print() on the visible page (which would print
   * the whole app chrome, not just the document). Works for both PDFs
   * (browser's native PDF viewer inside the iframe responds to
   * contentWindow.print()) and images (the iframe renders the bare
   * image, which prints the same way).
   */
  function handlePrint() {
    if (printFrameRef.current) printFrameRef.current.remove();
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.src = file.url;
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        // Cross-origin or blocked — fall back to opening it directly.
        window.open(file.url, '_blank', 'noopener,noreferrer');
      }
    };
    document.body.appendChild(frame);
    printFrameRef.current = frame;
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="truncate text-sm font-medium text-slate-700">{name}</p>
          <div className="flex items-center gap-1">
            {canPrint && (
              <button onClick={handlePrint} title="Print"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600 hover:scale-105 transition-all">
                <Printer size={15} />
              </button>
            )}
            <a href={file.url} download={name} title="Download"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600 hover:scale-105 transition-all">
              <Download size={15} />
            </a>
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
    </div>,
    document.body
  );
}
