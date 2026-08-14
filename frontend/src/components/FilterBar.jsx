import { useState } from 'react';
import { Search, Plus, Download } from 'lucide-react';
import { STATUS_STYLES } from './StatusBadge.jsx';
import { Button } from './ui/button.jsx';

const SORT_OPTIONS = [
  { value: 'expected_delivery_date:asc', label: 'Delivery date (soonest)' },
  { value: 'expected_delivery_date:desc', label: 'Delivery date (latest)' },
  { value: 'amount_remaining:desc', label: 'Amount remaining (highest)' },
  { value: 'amount_remaining:asc', label: 'Amount remaining (lowest)' },
  { value: 'total_cost:desc', label: 'Total cost (highest)' },
  { value: 'item_name:asc', label: 'Item name (A–Z)' },
];

export default function FilterBar({ query, setQuery, status, setStatus, sort, setSort, onAddClick, onExport }) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search by asset name or vendor */}
        <div className="relative w-full sm:w-72">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search asset or vendor…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>

        {/* Filter by order status */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_STYLES)
            // "Delivered" purchases move to Successful Order History and
            // no longer appear on this dashboard (except as a
            // maintenance alert) — offering it here as a filter would
            // just show an empty table most of the time.
            .filter(([value]) => value !== 'delivered')
            .map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
        </select>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>Sort: {opt.label}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={handleExport} loading={exporting}>
          <Download size={16} /> Export CSV
        </Button>
        <Button variant="primary" onClick={onAddClick}>
          <Plus size={16} /> New Purchase
        </Button>
      </div>
    </div>
  );
}
