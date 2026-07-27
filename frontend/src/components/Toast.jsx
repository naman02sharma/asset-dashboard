import { useEffect } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

/**
 * Transient feedback banner for actions (purchase created, moved to
 * history, restored, etc). Auto-dismisses after 3s. Rendered by App.jsx
 * from a single { message, type } piece of state — call showToast()
 * again to replace it, no queue needed for a dashboard this size.
 */
export default function Toast({ message, type = 'success', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  const isSuccess = type === 'success';

  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-[slideUp_0.2s_ease-out]">
      <div className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${
        isSuccess ? 'bg-slate-900' : 'bg-red-600'
      }`}>
        {isSuccess ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        {message}
      </div>
    </div>
  );
}
