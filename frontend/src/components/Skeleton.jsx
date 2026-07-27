/**
 * Shimmering placeholder bar — the base building block for all
 * skeleton loading states in the app (table rows, cards, drawers),
 * used instead of a plain spinner+text so the layout the data will
 * land in is visible immediately.
 */
export function SkeletonBar({ className = '' }) {
  return <div className={`animate-pulse rounded bg-slate-200/70 ${className}`} />;
}

/**
 * A full skeleton row for a `<table>` — same column count/spacing as
 * the real rows so nothing jumps when data arrives.
 */
export function SkeletonTableRows({ columns = 6, rows = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-slate-100 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <SkeletonBar className={`h-3.5 ${c === 0 ? 'w-28' : 'w-16'}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Skeleton for the card-style rows used in Successful Order History. */
export function SkeletonCardRows({ rows = 4 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
          <div className="flex-1 space-y-2">
            <SkeletonBar className="h-3.5 w-40" />
            <SkeletonBar className="h-3 w-56" />
          </div>
          <SkeletonBar className="h-3.5 w-16" />
          <SkeletonBar className="h-7 w-16 rounded-lg" />
        </div>
      ))}
    </>
  );
}
