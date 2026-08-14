import { forwardRef } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';

/**
 * Shared Button primitive — adapted from Kokonut UI's button anatomy
 * (github.com/kokonut-labs/kokonutui: spring press feedback, a
 * diagonal "shine" sweep on hover, a built-in loading state) but
 * themed with this app's own brand/slate palette instead of Kokonut's
 * default zinc theme, so it reads as native to this dashboard rather
 * than a bolted-on template. `variant="primary"` reproduces the exact
 * gradient every "New X" / submit button already used
 * (from-brand-500 to-brand-600) so this is a drop-in replacement,
 * not a redesign — same colors, same disabled/loading behavior,
 * just one shared implementation instead of the class string being
 * hand-repeated (and drifting slightly) across ~20 files.
 */
const VARIANTS = {
  primary:
    'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-sm hover:from-brand-600 hover:to-brand-700 focus-visible:ring-brand-300',
  secondary:
    'border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-slate-300',
  outline:
    'border border-slate-200 bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-slate-300',
  ghost:
    'text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-slate-300',
  destructive:
    'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm hover:from-red-600 hover:to-red-700 focus-visible:ring-red-300',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  default: 'h-9 px-3.5 text-sm gap-1.5 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-lg',
  icon: 'h-9 w-9 justify-center rounded-lg',
};

export const Button = forwardRef(function Button(
  { className, variant = 'primary', size = 'default', loading = false, disabled = false, children, ...props },
  ref
) {
  const isDisabled = disabled || loading;
  return (
    <motion.button
      ref={ref}
      whileTap={isDisabled ? undefined : { scale: 0.96 }}
      disabled={isDisabled}
      className={cn(
        'group relative inline-flex shrink-0 items-center overflow-hidden font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {/* Kokonut-style diagonal shine sweep on hover — purely
          decorative, sits behind the content and never intercepts
          clicks. Skipped on ghost/outline (no fill to shine against). */}
      {(variant === 'primary' || variant === 'destructive') && (
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
      )}
      <span className="relative inline-flex items-center gap-1.5">
        {loading && <Loader2 size={14} className="animate-spin" />}
        {children}
      </span>
    </motion.button>
  );
});
