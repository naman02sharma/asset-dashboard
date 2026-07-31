import { useRef, useState } from 'react';
import { X, UploadCloud, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api/api.js';

const TEMPLATE_HEADERS = [
  'Asset Name', 'Category', 'Serial Number', 'Asset Tag', 'Location', 'Vendor',
  'Purchase Date', 'Cost', 'Warranty Expiry', 'Useful Life (Years)', 'AMC Provider', 'AMC Start Date', 'AMC End Date', 'AMC Cost',
];
const TEMPLATE_EXAMPLE = [
  'Dell Latitude 5440', 'Laptop', 'SN-88213', '', 'HO - 3rd Floor', 'Dell India',
  '2026-01-15', '65000', '2028-01-15', '4', '', '', '', '',
];

function downloadTemplate() {
  const csv = '\uFEFF' + [TEMPLATE_HEADERS.join(','), TEMPLATE_EXAMPLE.join(',')].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'asset-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Bulk-loads assets from a CSV — the on-ramp for anyone adopting this
 * app who already has an inventory spreadsheet, instead of re-typing
 * every row by hand through "New Asset". Column matching happens
 * server-side (see assetController.importAssets / IMPORT_COLUMN_MAP)
 * case-insensitively, so a file re-exported from this app's own
 * "Export CSV" (which has a few extra columns like Status/Holder)
 * imports cleanly too — those extra columns are just ignored.
 *
 * Every row succeeds or fails independently; one bad row (missing
 * name, a duplicate Asset Tag) never blocks the rest of the file.
 */
export default function ImportAssetsModal({ onClose, onImported }) {
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null); // { imported, total, results }
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    setError('');
    setResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const res = await api.importAssets(text);
      setResult(res);
      if (res.imported > 0) onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  const failedRows = result?.results.filter((r) => !r.success) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <UploadCloud size={15} />
            </span>
            <h2 className="text-base font-semibold text-slate-900">Import Assets from CSV</h2>
          </div>
          <button onClick={onClose} title="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <button onClick={downloadTemplate}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 transition-colors">
            <Download size={13} /> Download a template CSV
          </button>

          <div
            onClick={() => inputRef.current?.click()}
            role="button" tabIndex={0}
            className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center hover:border-brand-300 hover:bg-brand-50/40 transition-colors"
          >
            <UploadCloud size={22} className="text-slate-400" />
            <p className="text-sm text-slate-600"><span className="font-medium text-brand-600">Click to choose</span> a CSV file</p>
            {fileName && <p className="text-xs text-slate-400">{fileName}</p>}
          </div>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])} />

          {importing && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-400">
              <Loader2 size={16} className="animate-spin" /> Importing…
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {result && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <CheckCircle2 size={15} className="text-green-600" />
                {result.imported} of {result.total} row{result.total === 1 ? '' : 's'} imported
              </p>
              {failedRows.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-red-100 bg-red-50/50 p-2">
                  {failedRows.map((r) => (
                    <li key={r.row} className="flex items-start gap-1.5 text-xs text-red-700">
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      <span>Row {r.row}: {r.error}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} title="Close" className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors">
            {result ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
