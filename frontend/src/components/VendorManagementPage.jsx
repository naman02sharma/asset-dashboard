import { useState, useMemo } from 'react';
import { Plus, Search, MapPin, Phone, Mail, Link, Pencil, Trash2 } from 'lucide-react';
import VendorFormModal from './VendorFormModal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from './ui/button.jsx';

// BUGFIX (uniformity audit): this page used to show its Edit pencil to
// every user regardless of role — the only "edit an existing record"
// control in the app that wasn't gated behind canEdit (PurchaseTable,
// InventoryPage, and CompletedOrdersPage all hide their equivalent
// edit/modify controls the same way). The backend's PATCH /vendors/:id
// is now admin-gated too (see backend/routes/vendors.js) — this is the
// matching frontend fix so a non-admin never sees a button that would
// just 403 anyway.
export default function VendorManagementPage({ vendors, onUpdateVendor, onCreateVendor, onDeleteVendor }) {
  const { canEdit, canDeleteVendor } = useAuth();
  const [query, setQuery] = useState('');
  const [activeVendor, setActiveVendor] = useState(null); // { mode: 'create' | 'edit', data: vendor }
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  function handleDeleteClick(id) {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      setTimeout(() => setConfirmingDeleteId((cur) => (cur === id ? null : cur)), 3000);
      return;
    }
    setConfirmingDeleteId(null);
    onDeleteVendor(id);
  }

  const filtered = useMemo(() => {
    let result = vendors || [];
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (v) =>
          v.name?.toLowerCase().includes(q) ||
          v.gst_number?.toLowerCase().includes(q) ||
          v.contact_email?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [vendors, query]);

  async function handleModalSubmit(form) {
    if (activeVendor.mode === 'create') {
      await onCreateVendor(form);
    } else {
      await onUpdateVendor(activeVendor.data.id, form);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vendors</h1>
          <p className="mt-1 text-sm text-slate-500">Manage all your suppliers and service providers.</p>
        </div>
        <Button onClick={() => setActiveVendor({ mode: 'create', data: null })}>
          <Plus size={16} /> Add Vendor
        </Button>
      </div>

      <div className="px-8 pb-4">
        {/* BUGFIX (uniformity audit): this used to wrap the search box
            below in the dashboard's <FilterBar>, which never actually
            renders its children -- it renders its own hardcoded
            search/status/sort/export/"New Purchase" toolbar instead
            (none of it wired to anything here, since VendorManagementPage
            never passed FilterBar's required props). That meant this
            page's real search box silently never appeared, and a dead
            "New Purchase" button showed in its place. Rendering the
            search box directly here, unwrapped, fixes both. */}
        <div className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
          <Search size={16} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search vendors..."
            className="w-full bg-transparent text-sm focus:outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((v) => (
            <div key={v.id} className="relative group rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/10">
              <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                {canEdit && (
                  <button
                    onClick={() => setActiveVendor({ mode: 'edit', data: v })}
                    className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                    title="Edit vendor"
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {canDeleteVendor && (
                  <button
                    onClick={() => handleDeleteClick(v.id)}
                    title={confirmingDeleteId === v.id ? 'Click again to confirm deletion' : 'Delete vendor'}
                    className={`p-2 rounded-lg transition-colors ${
                      confirmingDeleteId === v.id ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                    }`}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <h3 className="text-lg font-semibold text-slate-900 pr-8">{v.name}</h3>
              {v.gst_number && <span className="inline-flex mt-1 items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">GST: {v.gst_number}</span>}

              <div className="mt-4 space-y-2.5 text-sm text-slate-600">
                {v.contact_email && (
                  <div className="flex items-center gap-2 truncate">
                    <Mail size={14} className="text-slate-400 shrink-0" />
                    <a href={`mailto:${v.contact_email}`} className="truncate hover:text-brand-600 hover:underline">{v.contact_email}</a>
                  </div>
                )}
                {v.contact_phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={14} className="text-slate-400 shrink-0" />
                    <span>{v.contact_phone}</span>
                  </div>
                )}
                {v.website && (
                  <div className="flex items-center gap-2 truncate">
                    <Link size={14} className="text-slate-400 shrink-0" />
                    <a href={v.website} target="_blank" rel="noopener noreferrer" className="truncate hover:text-brand-600 hover:underline">{v.website}</a>
                  </div>
                )}
                {v.address && (
                  <div className="flex items-start gap-2">
                    <MapPin size={14} className="text-slate-400 shrink-0 mt-0.5" />
                    <span className="line-clamp-2 text-xs">{v.address}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-500">
              No vendors found. Try adjusting your search or add a new vendor.
            </div>
          )}
        </div>
      </div>

      {activeVendor && (
        <VendorFormModal
          mode={activeVendor.mode}
          vendor={activeVendor.data}
          onClose={() => setActiveVendor(null)}
          onSubmit={handleModalSubmit}
        />
      )}
    </div>
  );
}
