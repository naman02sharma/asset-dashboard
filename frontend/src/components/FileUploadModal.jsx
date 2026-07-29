import { useEffect, useRef, useState } from 'react';
import { X, UploadCloud, FileIcon, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import FilePreviewModal from './FilePreviewModal.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Centered modal + overlay for uploading files against an EXISTING
 * record (a purchase's insurance photos/invoices, an asset's AMC
 * contracts/invoices). Replaces the old corner popover — same
 * capabilities (list existing files, delete, add more) but as a
 * proper dialog: drag-and-drop zone, per-file upload progress, and an
 * always-visible Close button.
 *
 * Locks background scroll while open and restores it on unmount/close
 * so this never leaves the page stuck unscrollable.
 */
export default function FileUploadModal({ label, icon: Icon = FileIcon, accept, hint, files, recordId, onUpload, onDelete, onClose }) {
  const { canEdit } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState([]); // [{ name, progress, status: 'uploading'|'done'|'error', error? }]
  const [deleteError, setDeleteError] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const inputRef = useRef(null);

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

  async function handleFiles(list) {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;

    const entries = incoming.map((f) => ({ name: f.name, progress: 0, status: 'uploading' }));
    setUploads((u) => [...u, ...entries]);

    function setEntryProgress(name, progress) {
      setUploads((u) => u.map((e) => (e.name === name && e.status === 'uploading' ? { ...e, progress } : e)));
    }

    try {
      const result = await onUpload(recordId, incoming, (percent) => {
        for (const f of incoming) setEntryProgress(f.name, percent);
      });
      const failedNames = new Set((result?.results || []).filter((r) => !r.success).map((r) => r.name));
      setUploads((u) => u.map((e) => {
        if (!incoming.some((f) => f.name === e.name)) return e;
        return failedNames.has(e.name)
          ? { ...e, status: 'error', error: 'Upload failed' }
          : { ...e, status: 'done', progress: 100 };
      }));
    } catch (err) {
      setUploads((u) => u.map((e) => (incoming.some((f) => f.name === e.name) ? { ...e, status: 'error', error: err.message } : e)));
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  async function handleDelete(fileId) {
    setDeleteError('');
    try {
      await onDelete(recordId, fileId);
    } catch (err) {
      setDeleteError(err.message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon size={16} className="text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">{label}</h2>
          </div>
          <button onClick={onClose} title="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Drag & drop zone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50/60 hover:border-brand-300 hover:bg-brand-50/40'
            }`}
          >
            <UploadCloud size={22} className={dragOver ? 'text-brand-600' : 'text-slate-400'} />
            <p className="text-sm text-slate-600">
              <span className="font-medium text-brand-600">Click to upload</span> or drag and drop
            </p>
            {hint && <p className="text-xs text-slate-400">{hint}</p>}
          </div>
          <input ref={inputRef} type="file" accept={accept} multiple className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />

          {/* In-flight uploads with progress */}
          {uploads.length > 0 && (
            <div className="space-y-2">
              {uploads.map((u, i) => (
                <div key={`${u.name}-${i}`} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-slate-600">{u.name}</span>
                    {u.status === 'done' && <CheckCircle2 size={14} className="shrink-0 text-green-600" />}
                    {u.status === 'error' && <AlertCircle size={14} className="shrink-0 text-red-600" />}
                    {u.status === 'uploading' && <span className="shrink-0 text-slate-400">{u.progress}%</span>}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${u.status === 'error' ? 'bg-red-500' : u.status === 'done' ? 'bg-green-500' : 'bg-brand-500'}`}
                      style={{ width: `${u.status === 'error' ? 100 : u.progress}%` }}
                    />
                  </div>
                  {u.status === 'error' && <p className="mt-1 text-[11px] text-red-600">{u.error}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Already-uploaded files */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">Uploaded files ({files.length})</p>
            {files.length === 0 ? (
              <p className="text-xs text-slate-400">No files yet.</p>
            ) : (
              <ul className="space-y-1">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                    <button type="button" onClick={() => setPreviewFile(f)}
                      className="flex min-w-0 items-center gap-2 text-sm text-slate-600 hover:text-brand-600 hover:underline">
                      <FileIcon size={14} className="shrink-0 text-slate-400" />
                      <span className="truncate">{f.name || 'file'}</span>
                    </button>
                    {canEdit && (
                      <button onClick={() => handleDelete(f.id)} title="Delete this file"
                        className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {deleteError && <p className="mt-1.5 text-xs text-red-600">{deleteError}</p>}
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors">
            Close
          </button>
        </div>
      </div>

      {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}
