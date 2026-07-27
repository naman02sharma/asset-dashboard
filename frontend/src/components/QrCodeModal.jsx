import { useEffect, useState } from 'react';
import { X, Loader2, Download, QrCode } from 'lucide-react';
import { api } from '../api/api.js';

/**
 * Shows a scannable QR code unique to one asset — scanning it (with
 * any phone camera, no app or login needed) opens a small public page
 * with that asset's name, PO number, vendor, AMC status, etc. See
 * assetController.getAssetQrCode / publicController.getPublicAssetPage
 * for where the code/page actually come from.
 *
 * Fetched as a Blob rather than a plain <img src="..."> because the
 * endpoint requires the logged-in user's auth header, which a bare
 * <img> tag can't send.
 */
export default function QrCodeModal({ asset, onClose }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let objectUrl;
    api.getAssetQrCode(asset.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setImgUrl(objectUrl);
      })
      .catch((err) => setError(err.message));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset.id]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-2xl animate-[scaleIn_0.15s_ease-out]">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode size={16} className="text-brand-600" />
            <h2 className="text-sm font-semibold text-slate-900">Asset QR Code</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <p className="mb-3 truncate text-xs text-slate-400">{asset.asset_name}{asset.asset_tag ? ` · ${asset.asset_tag}` : ''}</p>

        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-4">
          {error && <p className="py-10 text-xs text-red-600">{error}</p>}
          {!error && !imgUrl && <div className="flex h-40 w-40 items-center justify-center text-slate-300"><Loader2 className="animate-spin" size={20} /></div>}
          {imgUrl && <img src={imgUrl} alt="Asset QR code" className="h-40 w-40" />}
        </div>

        <p className="mt-3 text-[11px] text-slate-400">
          Scanning this opens a read-only info page — no login needed. Print it and stick it on the asset.
        </p>

        {imgUrl && (
          <a href={imgUrl} download={`asset-qr-${asset.asset_tag || asset.id}.png`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-brand-700 transition-colors">
            <Download size={13} /> Download PNG
          </a>
        )}
      </div>
    </div>
  );
}
