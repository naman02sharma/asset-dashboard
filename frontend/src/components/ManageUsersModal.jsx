import { useEffect, useMemo, useState } from 'react';
import { X, ShieldCheck, User, Loader2, UserCheck, Clock, UserX, Trash2 } from 'lucide-react';
import { api } from '../api/api.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Admin-only — lists every account. Three things an admin can do here:
 *   - Approve/revoke access (is_approved) — a brand-new signup can't
 *     log in at all until approved (see 013_user_approval.sql /
 *     authController.login). Pending accounts are listed first, each
 *     showing how long they've been waiting.
 *   - Reject a still-pending signup outright (deleteUser) — distinct
 *     from Revoke, which only applies to an already-approved account.
 *     A pending signup left untouched is also auto-rejected by the
 *     daily cron after PENDING_USER_EXPIRY_DAYS (see
 *     trackingService.purgeStaleUnapprovedUsers) — this button is the
 *     immediate, manual version of that same cleanup.
 *   - Promote/demote role ('admin' <-> 'employee') for already-
 *     approved accounts. The backend refuses to demote the last
 *     remaining admin (updateUserRole) or revoke your own access
 *     (updateUserApproval), so neither can accidentally lock everyone
 *     out of admin-only actions.
 */
export default function ManageUsersModal({ onClose, showToast }) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [confirmingRejectId, setConfirmingRejectId] = useState(null);

  useEffect(() => {
    api.listUsers().then(setUsers).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const { pending, approved } = useMemo(() => {
    const rows = users || [];
    return {
      pending: rows.filter((u) => !u.is_approved),
      approved: rows.filter((u) => u.is_approved),
    };
  }, [users]);

  async function handleToggleRole(u) {
    const nextRole = u.role === 'admin' ? 'employee' : 'admin';
    setUpdatingId(u.id);
    try {
      const updated = await api.updateUserRole(u.id, nextRole);
      setUsers((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      showToast(`${updated.name} is now ${updated.role === 'admin' ? 'an admin' : 'an employee'}.`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleSetApproval(u, isApproved) {
    setUpdatingId(u.id);
    try {
      const updated = await api.updateUserApproval(u.id, isApproved);
      setUsers((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      showToast(isApproved ? `${updated.name} can now log in.` : `${updated.name}'s access was revoked.`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUpdatingId(null);
    }
  }

  // Click-to-confirm — same pattern used for other permanent-delete
  // actions elsewhere in the app (e.g. the Order History delete
  // button), rather than a browser confirm() dialog. A second click
  // within 3s actually rejects; otherwise it quietly resets.
  function handleRejectClick(u) {
    if (confirmingRejectId !== u.id) {
      setConfirmingRejectId(u.id);
      setTimeout(() => setConfirmingRejectId((current) => (current === u.id ? null : current)), 3000);
      return;
    }
    handleReject(u);
  }

  async function handleReject(u) {
    setConfirmingRejectId(null);
    setUpdatingId(u.id);
    try {
      await api.deleteUser(u.id);
      setUsers((rows) => rows.filter((r) => r.id !== u.id));
      showToast(`${u.name}'s signup was rejected.`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUpdatingId(null);
    }
  }

  function daysPending(createdAt) {
    const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
    return days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <ShieldCheck size={15} />
            </span>
            <h2 className="text-base font-semibold text-slate-900">Manage Users</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!users && !error && (
            <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
          )}
          {users && (
            <div className="space-y-5">
              {pending.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600">
                    <Clock size={12} /> Pending approval ({pending.length})
                  </p>
                  <ul className="space-y-1.5">
                    {pending.map((u) => (
                      <li key={u.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                            <Clock size={14} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-700">{u.name}</p>
                            <p className="truncate text-xs text-slate-400">{u.email} · waiting {daysPending(u.created_at)}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => handleSetApproval(u, true)}
                            disabled={updatingId === u.id}
                            title="Approve — lets this account log in"
                            className="flex items-center gap-1 rounded-full bg-green-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                          >
                            {updatingId === u.id ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={12} />} Approve
                          </button>
                          <button
                            onClick={() => handleRejectClick(u)}
                            disabled={updatingId === u.id}
                            title={confirmingRejectId === u.id ? 'Click again to confirm — this cannot be undone' : 'Reject — permanently removes this signup'}
                            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                              confirmingRejectId === u.id ? 'bg-red-600 text-white hover:bg-red-700' : 'text-slate-400 hover:bg-red-50 hover:text-red-600'
                            }`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                {pending.length > 0 && (
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Team</p>
                )}
                <ul className="space-y-1.5">
                  {approved.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${u.role === 'admin' ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-400'}`}>
                          {u.role === 'admin' ? <ShieldCheck size={14} /> : <User size={14} />}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-700">
                            {u.name} {u.id === currentUser.id && <span className="text-xs font-normal text-slate-400">(you)</span>}
                          </p>
                          <p className="truncate text-xs text-slate-400">{u.email}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => handleToggleRole(u)}
                          disabled={updatingId === u.id}
                          title={u.role === 'admin' ? 'Demote to employee' : 'Promote to admin'}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            u.role === 'admin' ? 'bg-brand-100 text-brand-700 hover:bg-brand-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {updatingId === u.id ? <Loader2 size={11} className="animate-spin" /> : u.role === 'admin' ? 'Admin' : 'Employee'}
                        </button>
                        {u.id !== currentUser.id && (
                          <button
                            onClick={() => handleSetApproval(u, false)}
                            disabled={updatingId === u.id}
                            title="Revoke access"
                            className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          >
                            <UserX size={13} />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
