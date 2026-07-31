import { createContext, useContext } from 'react';

/**
 * Provides the logged-in user (and convenience role flags) to any
 * component via useAuth(), instead of threading `user` as a prop
 * through every intermediate layer (App -> Dashboard -> PurchaseTable
 * -> AdvancePaymentEditor, etc.) just so a deeply-nested button can
 * decide whether to render.
 *
 * Three-role model (see database/017_senior_role.sql):
 *   - isAdmin: role === 'admin' only. Gates deleting anything, the
 *     Employee Status (HR) page, Manage Users, and anything else that
 *     touches user roles/approvals/HR data.
 *   - canApprove: role === 'admin' || role === 'senior'. Gates the
 *     asset/purchase approval workflow (018_asset_approval_workflow.sql)
 *     — approving or rejecting a pending purchase.
 *   - canEdit: true for ANY logged-in user (admin/senior/employee
 *     alike) — editing purchases/assets/vendors/inventory holders is
 *     open to everyone now, matching the backend's plain
 *     authenticateToken-only gating on those routes (see
 *     routes/purchases.js, assets.js, vendors.js, employees.js). Kept
 *     as its own flag (rather than inlined as `!!user` at every call
 *     site) so the many existing `canEdit &&` gates throughout the
 *     app keep working unchanged if this ever needs to tighten again.
 *   - canDeleteVendor: role === 'admin' || role === 'senior'. Same two
 *     roles as canApprove, but kept as its OWN flag rather than reused
 *     — this is a narrow, deliberate exception to the "delete is
 *     admin-only" rule that holds everywhere else (purchases, assets,
 *     files), specific to vendors, per explicit request. Reusing
 *     canApprove here would read as if deleting a vendor were part of
 *     the approval workflow, which it isn't.
 */
const AuthContext = createContext({ user: null, isAdmin: false, canApprove: false, canEdit: false, canDeleteVendor: false });

export function AuthProvider({ user, children }) {
  const role = user?.role;
  const isAdmin = role === 'admin';
  const canApprove = role === 'admin' || role === 'senior';
  const canEdit = !!user;
  const canDeleteVendor = role === 'admin' || role === 'senior';
  return (
    <AuthContext.Provider value={{ user, isAdmin, canApprove, canEdit, canDeleteVendor }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
