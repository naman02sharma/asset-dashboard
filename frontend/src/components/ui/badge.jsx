import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

// shadcn/ui-style Badge -- one reusable pill primitive with a small
// palette of variants, instead of every status/role pill in the app
// hand-rolling its own "rounded-full px-1.5 py-0.5 text-[10px] ..."
// classes slightly differently. Not a forced rip-and-replace of every
// existing pill (many are fine as-is and tied to specific approval/
// status logic in ApprovalStatusBadge.jsx / AssetStatusBadge.jsx) --
// this is the shared building block for new/updated ones, starting
// with the header's role badge.
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors',
  {
    variants: {
      variant: {
        brand: 'bg-brand-100 text-brand-700',
        amber: 'bg-amber-100 text-amber-700',
        green: 'bg-green-100 text-green-700',
        red: 'bg-red-100 text-red-700',
        purple: 'bg-purple-100 text-purple-700',
        blue: 'bg-blue-100 text-blue-700',
        slate: 'bg-slate-100 text-slate-600',
        gradient: 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-sm',
      },
    },
    defaultVariants: { variant: 'slate' },
  }
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
