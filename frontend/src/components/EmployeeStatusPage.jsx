import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ShieldCheck, User, Network, LayoutList, Pencil, Check, X, Download, Users2, UserCheck2, Building2, UserX } from 'lucide-react';
import { api } from '../api/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-xs text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

/**
 * Employee Status / HR Dashboard — a full page (not a modal, unlike
 * ManageUsersModal) reachable from the header's People icon. Reuses
 * the SAME data as Manage Users (GET /api/auth/users, admin-only) but
 * surfaces the HR-specific fields that panel doesn't: department,
 * position, who reports to whom, and login/logoff timestamps — plus a
 * dedicated reporting-hierarchy tree view.
 *
 * Two tabs:
 *  - Directory: filterable/searchable table of every account, with
 *    inline editing (department/position/manager) for admins.
 *  - Reporting Structure: a tree built from manager_id, rooted at
 *    whoever has no manager set.
 */
export default function EmployeeStatusPage({ onBack, showToast }) {
  const { isAdmin, user: currentUser } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('directory'); // 'directory' | 'hierarchy'

  const [query, setQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '', 'active', 'inactive'
  const [roleFilter, setRoleFilter] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ department: '', position: '', manager_id: '' });
  const [savingId, setSavingId] = useState(null);
  const [exporting, setExporting] = useState(false);

  function loadUsers() {
    api.listUsers()
      .then((rows) => setUsers(rows))
      .catch((err) => setError(err.message));
  }
  useEffect(() => { loadUsers(); }, []);

  const departments = useMemo(() => {
    const set = new Set((users || []).map((u) => u.department).filter(Boolean));
    return [...set].sort();
  }, [users]);

  // Employee Status KPI strip — total headcount, active vs inactive,
  // admins, and how many distinct departments are represented. Purely
  // derived from the same `users` list already loaded, no extra call.
  const kpis = useMemo(() => {
    const rows = users || [];
    return {
      total: rows.length,
      active: rows.filter((u) => u.is_approved).length,
      admins: rows.filter((u) => u.role === 'admin').length,
      departments: departments.length,
    };
  }, [users, departments]);

  async function handleExport() {
    setExporting(true);
    try {
      await api.exportEmployees();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handleRoleChange(u, nextRole) {
    if (nextRole === u.role) return;
    setSavingId(u.id);
    try {
      const updated = await api.updateUserRole(u.id, nextRole);
      setUsers((rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      const label = updated.role === 'admin' ? 'an admin' : updated.role === 'senior' ? 'a senior' : 'an employee';
      showToast(`${updated.name} is now ${label}.`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function handleToggleActive(u) {
    setSavingId(u.id);
    try {
      const updated = await api.updateUserApproval(u.id, !u.is_approved);
      setUsers((rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      showToast(updated.is_approved ? `${updated.name} is now active.` : `${updated.name} was marked inactive.`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingId(null);
    }
  }

  const filtered = useMemo(() => {
    let rows = users || [];
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.position || '').toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q)
      );
    }
    if (departmentFilter) rows = rows.filter((u) => u.department === departmentFilter);
    if (statusFilter === 'active') rows = rows.filter((u) => u.is_approved);
    if (statusFilter === 'inactive') rows = rows.filter((u) => !u.is_approved);
    if (roleFilter) rows = rows.filter((u) => u.role === roleFilter);
    return rows;
  }, [users, query, departmentFilter, statusFilter, roleFilter]);

  function startEdit(u) {
    setEditingId(u.id);
    setEditForm({ department: u.department || '', position: u.position || '', manager_id: u.manager_id || '' });
  }
  function cancelEdit() {
    setEditingId(null);
  }
  async function saveEdit(u) {
    setSavingId(u.id);
    try {
      const updated = await api.updateEmployeeDetails(u.id, editForm);
      setUsers((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      setEditingId(null);
      showToast(`Updated ${updated.name}'s HR details.`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingId(null);
    }
  }

  // Builds a reporting tree from the flat user list: everyone with no
  // manager_id (or whose manager isn't in this list) is a root; every
  // other row nests under its manager_id. A defensive visited-set stops
  // an accidental cycle in the data from recursing forever — the
  // backend already blocks creating one going forward (see
  // authController.updateEmployeeDetails), but this guards against
  // stale/pre-existing data too.
  const tree = useMemo(() => {
    const rows = users || [];
    const byId = new Map(rows.map((u) => [u.id, u]));
    const childrenOf = new Map();
    const roots = [];
    for (const u of rows) {
      if (u.manager_id && byId.has(u.manager_id)) {
        if (!childrenOf.has(u.manager_id)) childrenOf.set(u.manager_id, []);
        childrenOf.get(u.manager_id).push(u);
      } else {
        roots.push(u);
      }
    }
    return { roots, childrenOf };
  }, [users]);

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 px-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="mb-1 text-xs font-medium text-slate-500 hover:text-brand-600">
            &larr; Back to dashboard
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Employee Status</h1>
          <p className="mt-1 text-sm text-slate-500">
            Admin &amp; employee directory, reporting structure, and HR status — {isAdmin ? 'editable by admins.' : 'view-only.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} disabled={exporting || !users}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export CSV
          </button>
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            <button onClick={() => setTab('directory')}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${tab === 'directory' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              <LayoutList size={14} /> Directory
            </button>
            <button onClick={() => setTab('hierarchy')}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${tab === 'hierarchy' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Network size={14} /> Reporting Structure
            </button>
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}

      {!users && !error && (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="animate-spin" size={24} /></div>
      )}

      {users && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center gap-2 text-slate-400"><Users2 size={15} /><span className="text-xs font-medium uppercase tracking-wide">Total accounts</span></div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{kpis.total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center gap-2 text-slate-400"><UserCheck2 size={15} /><span className="text-xs font-medium uppercase tracking-wide">Active</span></div>
            <p className="mt-1.5 text-2xl font-bold text-green-700">{kpis.active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center gap-2 text-slate-400"><ShieldCheck size={15} /><span className="text-xs font-medium uppercase tracking-wide">Admins</span></div>
            <p className="mt-1.5 text-2xl font-bold text-brand-700">{kpis.admins}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center gap-2 text-slate-400"><Building2 size={15} /><span className="text-xs font-medium uppercase tracking-wide">Departments</span></div>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">{kpis.departments}</p>
          </div>
        </div>
      )}

      {users && tab === 'directory' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
              <Search size={15} className="text-slate-400" />
              <input type="text" placeholder="Search name, email, position, department..."
                className="w-full bg-transparent text-sm focus:outline-none"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 focus:border-brand-500 focus:outline-none">
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 focus:border-brand-500 focus:outline-none">
              <option value="">All roles</option>
              <option value="admin">Admin</option>
              <option value="senior">Senior</option>
              <option value="employee">Employee</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 focus:border-brand-500 focus:outline-none">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Position</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Reports to</th>
                    <th className="px-4 py-3">Date added</th>
                    <th className="px-4 py-3">Last login</th>
                    <th className="px-4 py-3">Last logoff</th>
                    <th className="px-4 py-3">Status</th>
                    {isAdmin && <th className="px-4 py-3 text-right">Edit</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((u) => {
                    const isEditing = editingId === u.id;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                              u.role === 'admin' ? 'bg-brand-50 text-brand-600' : u.role === 'senior' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-400'
                            }`}>
                              {u.role === 'admin' ? <ShieldCheck size={14} /> : u.role === 'senior' ? <Pencil size={14} /> : <User size={14} />}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-800">{u.name}</p>
                              <p className="truncate text-xs text-slate-400">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {isAdmin ? (
                            <select value={u.role} disabled={savingId === u.id}
                              onChange={(e) => handleRoleChange(u, e.target.value)}
                              title="Change role"
                              className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                u.role === 'admin' ? 'bg-brand-100 text-brand-700' : u.role === 'senior' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                              }`}>
                              <option value="employee">Employee</option>
                              <option value="senior">Senior</option>
                              <option value="admin">Admin</option>
                            </select>
                          ) : (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              u.role === 'admin' ? 'bg-brand-100 text-brand-700' : u.role === 'senior' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {u.role === 'admin' ? 'Admin' : u.role === 'senior' ? 'Senior' : 'Employee'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {isEditing
                            ? <input className={FIELD_CLASS} value={editForm.position}
                                onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))} placeholder="e.g. IT Manager" />
                            : (u.position || <span className="text-slate-300">—</span>)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {isEditing
                            ? <input className={FIELD_CLASS} value={editForm.department}
                                onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. IT" />
                            : (u.department
                                ? <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{u.department}</span>
                                : <span className="text-slate-300">—</span>)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {isEditing
                            ? (
                              <select className={FIELD_CLASS} value={editForm.manager_id}
                                onChange={(e) => setEditForm((f) => ({ ...f, manager_id: e.target.value }))}>
                                <option value="">No manager</option>
                                {users.filter((m) => m.id !== u.id).map((m) => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            )
                            : (u.manager_name || <span className="text-slate-300">—</span>)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(u.created_at)}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDateTime(u.last_login_at)}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDateTime(u.last_logout_at)}</td>
                        <td className="px-4 py-3">
                          {isAdmin && u.id !== currentUser.id ? (
                            <button onClick={() => handleToggleActive(u)} disabled={savingId === u.id}
                              title={u.is_approved ? 'Mark inactive (revokes access)' : 'Mark active (grants access)'}
                              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                u.is_approved ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}>
                              {savingId === u.id ? <Loader2 size={10} className="animate-spin" /> : u.is_approved ? <UserCheck2 size={10} /> : <UserX size={10} />}
                              {u.is_approved ? 'Active' : 'Inactive'}
                            </button>
                          ) : (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.is_approved ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                              {u.is_approved ? 'Active' : 'Inactive'}{u.id === currentUser.id && ' (you)'}
                            </span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-right">
                            {isEditing ? (
                              <div className="flex justify-end gap-1">
                                <button onClick={() => saveEdit(u)} disabled={savingId === u.id}
                                  className="flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-white transition-all hover:scale-105 hover:bg-green-700 disabled:opacity-50 disabled:hover:scale-100">
                                  {savingId === u.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
                                </button>
                                <button onClick={cancelEdit} title="Cancel" disabled={savingId === u.id}
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-all hover:scale-105 hover:bg-slate-100">
                                  <X size={13} />
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => startEdit(u)}
                                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-all hover:scale-105 hover:bg-brand-50 hover:text-brand-600 ml-auto">
                                <Pencil size={13} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={isAdmin ? 10 : 9} className="px-4 py-10 text-center text-slate-400">No accounts match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {users && tab === 'hierarchy' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {tree.roots.length === 0 && <p className="text-sm text-slate-400">No accounts to show.</p>}
          <ul className="space-y-1">
            {tree.roots.map((root) => (
              <HierarchyNode key={root.id} user={root} childrenOf={tree.childrenOf} depth={0} />
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

function HierarchyNode({ user, childrenOf, depth }) {
  const children = childrenOf.get(user.id) || [];
  return (
    <li>
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50" style={{ marginLeft: depth * 28 }}>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          user.role === 'admin' ? 'bg-brand-50 text-brand-600' : user.role === 'senior' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-400'
        }`}>
          {user.role === 'admin' ? <ShieldCheck size={13} /> : user.role === 'senior' ? <Pencil size={13} /> : <User size={13} />}
        </span>
        <div className="min-w-0">
          <span className="text-sm font-medium text-slate-800">{user.name}</span>
          {user.position && <span className="ml-2 text-xs text-slate-400">{user.position}</span>}
          {!user.is_approved && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Inactive</span>}
        </div>
      </div>
      {children.length > 0 && (
        <ul className="space-y-1">
          {children.map((child) => (
            <HierarchyNode key={child.id} user={child} childrenOf={childrenOf} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
