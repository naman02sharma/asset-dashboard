import { useState } from 'react';
import { X, Mail, Phone } from 'lucide-react';
import { api } from '../api/api.js';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

export default function NotificationSettingsModal({ user, onClose, onSaved }) {
  const [channel, setChannel] = useState(user.notify_channel || 'email');
  const [email, setEmail] = useState(user.notify_email || user.email || '');
  const [phone, setPhone] = useState(user.notify_phone || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const updated = await api.updateNotificationSettings({
        notify_channel: channel,
        notify_email: email,
        notify_phone: phone,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Notification Settings</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <p className="text-sm text-slate-500">
            Choose where delivery status and payment updates get sent.
          </p>

          <div className="flex gap-2">
            <button type="button" onClick={() => setChannel('email')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm ${
                channel === 'email' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500'
              }`}>
              <Mail size={14} /> Gmail
            </button>
            <button type="button" onClick={() => setChannel('sms')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm ${
                channel === 'sms' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500'
              }`}>
              <Phone size={14} /> Phone (SMS)
            </button>
          </div>

          {channel === 'email' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Gmail address</label>
              <input required type="email" className={FIELD_CLASS} value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Phone number</label>
              <input required type="tel" className={FIELD_CLASS} value={phone}
                onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-700 disabled:opacity-60 active:scale-95 transition-all">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
