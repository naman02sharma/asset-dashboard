import { Toaster as SonnerToaster } from 'sonner';

/**
 * shadcn/ui-style wrapper around sonner's <Toaster/> -- themed to
 * match this app's existing card conventions (rounded-xl, soft
 * shadow, Inter font) rather than sonner's plain default look.
 * richColors gives success/error toasts their own vivid green/red
 * tint instead of the old Toast.jsx's single dark-slate-for-everything
 * look -- keeps the same success/error distinction, just more alive.
 * Rendered once near the app root; every existing showToast(message,
 * type) call site elsewhere in the app is unchanged -- only what
 * showToast does internally changed (see App.jsx).
 */
export function Toaster(props) {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-xl border shadow-lg shadow-slate-900/10 font-sans',
          title: 'text-sm font-medium',
          description: 'text-xs',
          closeButton: 'border-none',
        },
      }}
      {...props}
    />
  );
}
