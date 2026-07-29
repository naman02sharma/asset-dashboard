import { createContext, useContext } from 'react';

/**
 * Provides the logged-in user (and convenience role flags) to any
 * component via useAuth(), instead of threading `user` as a prop
 * through every intermediate layer (App -> Dashboard -> PurchaseTable
 * -> AdvancePaymentEditor, etc.) just so a deeply-nested button can
 * decide whether to render.
 *
 * Three-role model (see database/017_editor_role.sql):
 *   - isAdmin: role === 'admin' only. Gates the Employee Status (HR)
 *     page, Manage Users, and anything else that touches user
 *     roles/approvals/HR data — 'editor' deliberately does NOT get
 *     this, by design.
 *   - canEdit: role === 'admin' || role === 'editor'. Gates
 *     operational edit/delete actions on purchases, inventory assets,
 *     vendors, and inventory holder records — the same set of actions
 *     the backend's requireAdminOrEditor middleware allows.
 */
const AuthContext = createContext({ user: null, isAdmin: false, canEdit: false });

export function AuthProvider({ user, children }) {
  const role = user?.role;
  const isAdmin = role === 'admin';
  const canEdit = role === 'admin' || role === 'editor';
  return (
    <AuthContext.Provider value={{ user, isAdmin, canEdit }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
