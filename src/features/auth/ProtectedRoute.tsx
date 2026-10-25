import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/ui';
import { useAuth } from './AuthProvider';

export function ProtectedRoute() {
  const { loading, session, profile } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session || !profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { loading, session, profile } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (session && profile) return <Navigate to="/" replace />;
  return <Outlet />;
}

import { canOpen } from '@/lib/navigation';

/** Redirects to the dashboard when the user's role may not open this page. */
export function RequireAccess({ path, children }: { path: string; children: React.ReactNode }) {
  const { isSuperAdmin, activeRole } = useAuth();
  return canOpen(path, { isSuperAdmin, role: activeRole }) ? <>{children}</> : <Navigate to="/" replace />;
}
