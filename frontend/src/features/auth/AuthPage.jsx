import PropTypes from 'prop-types';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from './AuthContext.jsx';

export default function AuthPage({ register = false }) {
  const { client, busy, error: sessionError } = useAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (submitting || busy) return;
    const fields = new FormData(event.currentTarget);
    const password = fields.get('password');
    setError('');
    if (new TextEncoder().encode(password).length > 72) {
      setError('Password must not exceed 72 UTF-8 bytes.');
      return;
    }
    if (register && password !== fields.get('confirmPassword')) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const body = { email: fields.get('email').trim(), password };
      if (register)
        Object.assign(body, {
          name: fields.get('name').trim(),
          role: fields.get('role'),
        });
      await client[register ? 'register' : 'login'](body);
    } catch (failure) {
      setError(
        failure.details?.length
          ? failure.details.map((detail) => detail.message).join(' ')
          : failure.message,
      );
    } finally {
      setSubmitting(false);
    }
  }
  const pending = submitting || busy;
  return (
    <div className="auth-layout">
      <section className="intro">
        <p className="eyebrow">YOUR NEXT CHAPTER</p>
        <h1>{register ? 'Start with possibility.' : 'Welcome back.'}</h1>
        <p>
          A place for students and recruiters to connect with their next
          opportunity.
        </p>
        <span className="intro-rule" />
        <p className="small">PlacementHub · Your career, taking shape.</p>
      </section>
      <section className="card">
        <h2>{register ? 'Create your account' : 'Sign in to PlacementHub'}</h2>
        <p className="muted">
          {register
            ? 'Choose the role that fits you.'
            : 'Enter your details to continue.'}
        </p>
        <form onSubmit={submit}>
          <fieldset disabled={pending}>
            {register && (
              <label>
                Full name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
            {register && (
              <label>
                I am a
                <select name="role" defaultValue="student">
                  <option value="student">Student</option>
                  <option value="recruiter">Recruiter</option>
                </select>
              </label>
            )}
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={8}
                aria-describedby={register ? 'password-hint' : undefined}
              />
            </label>
            {register && (
              <>
                <p id="password-hint" className="hint">
                  At least 8 characters; no more than 72 UTF-8 bytes.
                </p>
                <label>
                  Confirm password
                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                </label>
              </>
            )}
            {(error || sessionError) && (
              <p className="error" role="alert">
                {error || sessionError}
              </p>
            )}
            <button type="submit">
              {pending
                ? 'Please wait…'
                : register
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </fieldset>
        </form>
        <p className="switch">
          {register ? 'Already have an account? ' : 'New to PlacementHub? '}
          <Link to={register ? '/login' : '/register'}>
            {register ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </section>
    </div>
  );
}

AuthPage.propTypes = { register: PropTypes.bool };
