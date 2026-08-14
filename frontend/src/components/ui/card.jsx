import { cn } from '../../lib/utils.js';

/**
 * Shared Card primitive — every KPI tile and chart container in the
 * app already used the same hand-written class string (rounded-xl
 * border, hover lift + brand-tinted glow shadow). Pulled into one
 * component, in the Kokonut UI idiom (github.com/kokonut-labs/
 * kokonutui/components/ui/card.tsx: a plain bordered surface plus a
 * soft ambient glow that fades in on hover), themed with this app's
 * own brand color rather than Kokonut's default. `hover` defaults to
 * on since every existing card used the hover treatment; set it to
 * false for a static surface. `className` (e.g. "p-5") controls
 * padding same as before — Card only owns the border/shadow/hover
 * behavior, not spacing, so it drops in wherever the old div sat.
 */
export function Card({ className, hover = true, children, ...props }) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm',
        hover && 'transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/10',
        className,
      )}
      {...props}
    >
      {hover && (
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-brand-100/0 blur-2xl transition-colors duration-300 group-hover:bg-brand-100/50" />
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
