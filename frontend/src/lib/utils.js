import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn/kokonut-ui helper — merges conditional class names
// (clsx) and then resolves any conflicting Tailwind utilities so the
// last one wins (twMerge), so a caller's className can safely
// override a primitive's default styling instead of both classes
// fighting for the same property.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
