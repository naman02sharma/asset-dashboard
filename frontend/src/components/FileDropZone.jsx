import { useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';

/**
 * Lightweight drag-and-drop file picker for forms where the record
 * doesn't exist yet (so nothing can actually upload until after
 * submit) — e.g. the New Purchase form's insurance photos / invoice
 * pickers. Purely client-side file selection; the parent owns the
 * `files` array and decides what happens with it on submit.
 */
export default function FileDropZone({ icon: Icon = UploadCloud, label, accept, files, onChange, hint }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  function addFiles(list) {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    onChange([...files, ...incoming]);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function removeAt(index) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon size={13} /> {label}
        {files.length > 0 && <span className="text-brand-600">({files.length} selected)</span>}
      </label>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors ${
          dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50/60 hover:border-brand-300 hover:bg-brand-50/40'
        }`}
      >
        <UploadCloud size={18} className={dragOver ? 'text-brand-600' : 'text-slate-400'} />
        <p className="text-xs text-slate-500">
          <span className="font-medium text-brand-600">Click to upload</span> or drag and drop
        </p>
        {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />

      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
              <span className="truncate">{f.name}</span>
              <button type="button" onClick={() => removeAt(i)} className="shrink-0 text-slate-400 hover:text-red-600 transition-colors">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
