import { Link, Navigate, Route, Routes } from 'react-router';
import { GuestRoute, ProtectedRoute } from '../features/auth/RouteGuards.jsx';
import AuthPage from '../features/auth/AuthPage.jsx';
import AccountPage from '../features/auth/AccountPage.jsx';

export default function App() {
  return (
    <>
      <header>
        <Link className="brand" to="/">
          Placement<span>Hub</span>
          <span className="brand-dot" aria-hidden="true">
            .
          </span>
        </Link>
        <span className="header-note">Make room for what’s next.</span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/account" replace />} />
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<AuthPage key="login" />} />
            <Route
              path="/register"
              element={<AuthPage key="register" register />}
            />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/account" element={<AccountPage />} />
          </Route>
          {['student', 'recruiter', 'admin'].map((role) => (
            <Route key={role} element={<ProtectedRoute roles={[role]} />}>
              <Route path={'/' + role + '/account'} element={<AccountPage />} />
            </Route>
          ))}
          <Route
            path="*"
            element={
              <section className="card">
                <h1>Page not found</h1>
                <Link to="/">Go home</Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer>
        PlacementHub <span>Built for the next step.</span>
      </footer>
    </>
  );
}
