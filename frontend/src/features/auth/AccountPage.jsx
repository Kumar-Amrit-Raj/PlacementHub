import { Link } from 'react-router';
import { useAuth } from './AuthContext.jsx';

export default function AccountPage() {
  const { user, busy, error, client } = useAuth();
  return (
    <section className="card account">
      <p className="eyebrow">YOUR ACCOUNT</p>
      <h1>You’re signed in, {user.name}.</h1>
      <dl>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Account role</dt>
        <dd className="role">{user.role}</dd>
      </dl>
      <p>Your account is ready. Placement features are coming later.</p>
      <Link to={'/' + user.role + '/account'}>
        View your role-protected account
      </Link>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="logout"
        disabled={busy}
        onClick={() => {
          void client.logout().catch(() => {});
        }}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </section>
  );
}
