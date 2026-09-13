import OpportunityListPage from '../features/opportunities/OpportunityListPage.jsx';
import OpportunityEditorPage from '../features/opportunities/OpportunityEditorPage.jsx';
import OpportunityDetailPage from '../features/opportunities/OpportunityDetailPage.jsx';
import { Link, Navigate, Route, Routes } from 'react-router';
import { GuestRoute, ProtectedRoute } from '../features/auth/RouteGuards.jsx';
import AuthPage from '../features/auth/AuthPage.jsx';
import RoleNavigation from './RoleNavigation.jsx';
import ProfilePage from '../features/profiles/ProfilePage.jsx';
import CompanyListPage from '../features/companies/CompanyListPage.jsx';
import CompanyReviewPage from '../features/companies/CompanyReviewPage.jsx';
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
        <RoleNavigation />
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
          <Route element={<ProtectedRoute roles={['student']} />}>
            <Route
              path="/student/opportunities"
              element={<OpportunityListPage />}
            />
            <Route
              path="/student/opportunities/:id"
              element={<OpportunityDetailPage />}
            />
            <Route
              path="/student/profile"
              element={<ProfilePage role="student" />}
            />
          </Route>
          <Route element={<ProtectedRoute roles={['recruiter']} />}>
            <Route
              path="/recruiter/opportunities"
              element={<OpportunityListPage recruiter />}
            />
            <Route
              path="/recruiter/opportunities/new"
              element={<OpportunityEditorPage key="new" />}
            />
            <Route
              path="/recruiter/opportunities/:id/edit"
              element={<OpportunityEditorPage key="edit" />}
            />
            <Route
              path="/recruiter/profile"
              element={<ProfilePage role="recruiter" />}
            />
          </Route>
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="/admin/companies" element={<CompanyListPage />} />
            <Route
              path="/admin/companies/:id"
              element={<CompanyReviewPage />}
            />
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
