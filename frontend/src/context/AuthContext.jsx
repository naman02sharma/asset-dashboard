import { createContext, useContext } from 'react';

/**
 * Provides the logged-in user (and a convenience isAdmin flag) to any
 * component via useAuth(), instead of threading `user` as a prop
 * through every intermediate layer (App -> Dashboard -> PurchaseTable
 * -> AdvancePaymentEditor, etc.) just so a deeply-nested button can
 * decide whether to render.
 */
const AuthContext = createContext({ user: null, isAdmin: false });

export function AuthProvider({ user, children }) {
  return (
    <AuthContext.Provider value={{ user, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
