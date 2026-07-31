import { useEffect, useRef, useState } from 'react';
import { Search, Package, Boxes, Building2, Loader2, Hash } from 'lucide-react';
import { api } from '../api/api.js';

/**
 * One search box for three different endpoints (purchases, assets,
 * vendors — there's no unified backend search, so this fires all
 * three in parallel client-side and groups the results). Picking a
 * result navigates to the right place and seeds that page's own
 * search box with the matched name, rather than trying to render
 * results inline here.
 */
export default function GlobalSearch({ onGoToPurchase, onGoToAsset, onGoToVendor, onGoToPoNumber }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({ purchases: [], assets: [], vendors: [], poNumbers: [] });
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults({ purchases: [], assets: [], vendors: [], poNumbers: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const needle = trimmed.toLowerCase();
      const [purchases, assets, vendors, poSearch] = await Promise.all([
        api.getPurchases({ q: trimmed }).catch(() => []),
        api.getAssets({ q: trimmed }).catch(() => []),
        api.getVendors().then((v) => v.filter((x) => x.name?.toLowerCase().includes(needle))).catch(() => []),
        // Deliberately separate from the purchases/assets lookups
        // above — those two are scoped to the dashboard's own
        // filtering rules (e.g. delivered purchases drop off
        // listPurchases entirely), while a PO number should surface
        // its full details no matter what state it's in (see
        // searchByPoNumber in purchaseController.js).
        api.searchByPoNumber(trimmed).catch(() => ({ purchases: [], assets: [] })),
      ]);
      // Merge both sides of the PO match into one flat list of "PO
      // number -> item name" pairs, deduplicated by po_number so a PO
      // that's both an approved purchase AND its auto-linked
      // Inventory asset doesn't show twice. Assets go FIRST in the
      // dedup so the asset side wins when both exist -- it's the more
      // current record (same reasoning as LocationPosPage.jsx).
      const seen = new Set();
      const poNumbers = [...(poSearch.assets || []), ...(poSearch.purchases || [])]
        .filter((row) => {
          if (!row.po_number || seen.has(row.po_number)) return false;
          seen.add(row.po_number);
          return true;
        })
        .map((row) => ({ po_number: row.po_number, label: row.item_name || row.asset_name }));

      setResults({ purchases: purchases.slice(0, 5), assets: assets.slice(0, 5), vendors: vendors.slice(0, 5), poNumbers: poNumbers.slice(0, 5) });
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const hasResults = results.purchases.length || results.assets.length || results.vendors.length || results.poNumbers.length;

  function pick(fn, arg) {
    fn(arg);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search purchases, assets, vendors…"
          className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-2 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 transition-colors"
        />
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Searching…
            </div>
          )}

          {!loading && !hasResults && (
            <p className="px-2 py-4 text-center text-sm text-slate-400">No matches.</p>
          )}

          {!loading && results.poNumbers.length > 0 && (
            <ResultGroup label="PO Numbers" icon={Hash}>
              {results.poNumbers.map((r) => (
                <ResultItem key={r.po_number} title={r.po_number} subtitle={r.label}
                  onClick={() => pick(onGoToPoNumber, r.po_number)} />
              ))}
            </ResultGroup>
          )}

          {!loading && results.purchases.length > 0 && (
            <ResultGroup label="Purchases" icon={Package}>
              {results.purchases.map((p) => (
                <ResultItem key={p.id} title={p.item_name} subtitle={p.vendor_name}
                  onClick={() => pick(onGoToPurchase, p.item_name)} />
              ))}
            </ResultGroup>
          )}

          {!loading && results.assets.length > 0 && (
            <ResultGroup label="Inventory assets" icon={Boxes}>
              {results.assets.map((a) => (
                <ResultItem key={a.id} title={a.asset_name} subtitle={a.category || a.vendor_name}
                  onClick={() => pick(onGoToAsset, a.asset_name)} />
              ))}
            </ResultGroup>
          )}

          {!loading && results.vendors.length > 0 && (
            <ResultGroup label="Vendors" icon={Building2}>
              {results.vendors.map((v) => (
                <ResultItem key={v.id} title={v.name} subtitle={v.gst_number ? `GST ${v.gst_number}` : ''}
                  onClick={() => pick(onGoToVendor, v.name)} />
              ))}
            </ResultGroup>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ label, icon: Icon, children }) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        <Icon size={11} /> {label}
      </p>
      {children}
    </div>
  );
}

function ResultItem({ title, subtitle, onClick }) {
  return (
    <button onClick={onClick}
      className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-slate-50 transition-colors">
      <span className="text-sm text-slate-700">{title}</span>
      {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
    </button>
  );
}
