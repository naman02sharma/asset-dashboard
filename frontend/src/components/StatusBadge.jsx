import { ChevronDown } from 'lucide-react';

// Central source of truth for status -> color mapping. Referenced by
// both the table rows and the filter dropdown so colors never drift.
export const STATUS_STYLES = {
  ordered:            { label: 'Ordered',          dot: 'bg-amber-500',  text: 'text-amber-700',  bg: 'bg-amber-50',  ring: 'ring-amber-200'  },
  shipped:            { label: 'Shipped',          dot: 'bg-amber-500',  text: 'text-amber-700',  bg: 'bg-amber-50',  ring: 'ring-amber-200'  },
  out_for_delivery:   { label: 'Out for Delivery', dot: 'bg-amber-500',  text: 'text-amber-700',  bg: 'bg-amber-50',  ring: 'ring-amber-200'  },
  partially_delivered:{ label: 'Partially Delivered', dot: 'bg-blue-500', text: 'text-blue-700',  bg: 'bg-blue-50',   ring: 'ring-blue-200'   },
  delivered:          { label: 'Delivered',        dot: 'bg-green-500',  text: 'text-green-700',  bg: 'bg-green-50',  ring: 'ring-green-200'  },
  delayed:            { label: 'Delayed',          dot: 'bg-red-500',    text: 'text-red-700',    bg: 'bg-red-50',    ring: 'ring-red-200'    },
  cancelled:          { label: 'Cancelled',        dot: 'bg-slate-400',  text: 'text-slate-600',  bg: 'bg-slate-100', ring: 'ring-slate-300'  },
};

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.ordered;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

/**
 * Same color-coded pill as StatusBadge, but rendered as a <select> so
 * status can be changed directly from the table. `onChange` receives
 * the new status value; the parent is responsible for calling the API
 * and refreshing data (see PurchaseTable -> App.jsx).
 *
 * Visual pass: a colored ring instead of a flat fill, a visible
 * chevron (the native <select> arrow was previously suppressed by
 * `appearance-none` with nothing put back in its place), and a subtle
 * hover lift — so it actually reads as an interactive control rather
 * than a static label that happens to be clickable.
 */
export function StatusSelect({ status, onChange, disabled }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.ordered;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1.5 text-xs font-medium ring-1 ring-inset transition-all ${style.bg} ${style.text} ${style.ring} ${
        disabled ? 'opacity-60' : 'hover:shadow-sm hover:brightness-95'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
      <span className="relative inline-flex items-center">
        <select
          value={status}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`cursor-pointer appearance-none border-0 bg-transparent py-0 pl-0 pr-4 text-xs font-medium ${style.text} focus:outline-none disabled:cursor-wait`}
        >
          {Object.entries(STATUS_STYLES).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <ChevronDown size={11} className="pointer-events-none absolute right-0 opacity-60" />
      </span>
    </span>
  );
}
