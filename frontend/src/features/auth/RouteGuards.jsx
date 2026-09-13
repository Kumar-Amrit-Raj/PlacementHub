import PropTypes from 'prop-types';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext.jsx';

export function AuthLoading() {
  return (
    <div className="notice" role="status">
      Checking your session…
    </div>
  );
}

export function ProtectedRoute({ roles }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <AuthLoading />;
  if (status !== 'authenticated')
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <section className="card">
        <h1>Access restricted</h1>
        <p>This page is not available for your account role.</p>
        <Link to="/account">Back to your account</Link>
      </section>
    );
  }
  return <Outlet />;
}

export function GuestRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <AuthLoading />;
  const from = location.state?.from;
  const destination =
    typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
      ? from
      : '/account';
  return status === 'authenticated' ? (
    <Navigate to={destination} replace />
  ) : (
    <Outlet />
  );
}

ProtectedRoute.propTypes = { roles: PropTypes.arrayOf(PropTypes.string) };
