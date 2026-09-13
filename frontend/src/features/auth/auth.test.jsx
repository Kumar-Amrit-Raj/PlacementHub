import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import App from '../../app/App.jsx';
import { AuthProvider } from './AuthContext.jsx';
import { createAuthClient } from '../../lib/api.js';

const user = {
  id: '1',
  name: 'Asha',
  email: 'asha@example.test',
  role: 'student',
};
const response = (body, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });
function renderApp(path, handler) {
  const fetcher = vi.fn(handler);
  const client = createAuthClient({ fetcher });
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider client={client}>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  return { client, fetcher };
}

describe('authentication pages and routes', () => {
  it('shows session loading then redirects anonymous users to login', async () => {
    let release;
    renderApp(
      '/account',
      () =>
        new Promise((resolve) => {
          release = () => resolve(response({}, 401));
        }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking your session',
    );
    await waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    expect(
      await screen.findByRole('heading', { name: 'Sign in to PlacementHub' }),
    ).toBeVisible();
  });

  it('signs in, loads the current user, and signs out', async () => {
    const actor = userEvent.setup();
    renderApp('/account', async (url, options) => {
      if (url.endsWith('/refresh')) return response({}, 401);
      if (url.endsWith('/login')) {
        expect(JSON.parse(options.body)).toEqual({
          email: user.email,
          password: 'long-password',
        });
        return response({ accessToken: 'signed-in' });
      }
      if (url.endsWith('/me')) return response({ user });
      expect(options.headers['X-CSRF-Protection']).toBe('1');
      return response(null, 204);
    });
    await screen.findByRole('heading', { name: 'Sign in to PlacementHub' });
    await actor.type(screen.getByLabelText('Email address'), user.email);
    await actor.type(screen.getByLabelText('Password'), 'long-password');
    await actor.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByRole('heading', { name: /You’re signed in, Asha/ }),
    ).toBeVisible();
    await actor.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to PlacementHub' }),
    ).toBeVisible();
  });

  it.each(['student', 'recruiter'])(
    'registers a %s without exposing admin registration',
    async (role) => {
      const actor = userEvent.setup();
      renderApp('/register', async (url, options) => {
        if (url.endsWith('/refresh')) return response({}, 401);
        if (url.endsWith('/register')) {
          expect(JSON.parse(options.body)).toEqual({
            name: 'Asha',
            email: user.email,
            password: 'long-password',
            role,
          });
          return response({ accessToken: 'registered' }, 201);
        }
        return response({ user: { ...user, role } });
      });
      await screen.findByRole('heading', { name: 'Create your account' });
      expect(
        screen.queryByRole('option', { name: /admin/i }),
      ).not.toBeInTheDocument();
      await actor.type(screen.getByLabelText('Full name'), 'Asha');
      await actor.type(screen.getByLabelText('Email address'), user.email);
      await actor.selectOptions(screen.getByLabelText('I am a'), role);
      await actor.type(
        screen.getByLabelText('Password', { exact: true }),
        'long-password',
      );
      await actor.type(
        screen.getByLabelText('Confirm password'),
        'long-password',
      );
      await actor.click(screen.getByRole('button', { name: 'Create account' }));
      expect(
        await screen.findByRole('heading', { name: /You’re signed in, Asha/ }),
      ).toBeVisible();
    },
  );

  it('rejects password mismatch before sending registration', async () => {
    const actor = userEvent.setup();
    const { fetcher } = renderApp('/register', async () => response({}, 401));
    await screen.findByRole('heading', { name: 'Create your account' });
    await actor.type(screen.getByLabelText('Full name'), 'Asha');
    await actor.type(screen.getByLabelText('Email address'), user.email);
    await actor.type(
      screen.getByLabelText('Password', { exact: true }),
      'long-password',
    );
    await actor.type(
      screen.getByLabelText('Confirm password'),
      'different-password',
    );
    await actor.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Passwords do not match',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('renders credential errors and re-enables submission', async () => {
    const actor = userEvent.setup();
    renderApp('/login', async () =>
      response({ error: 'Invalid email or password' }, 401),
    );
    await screen.findByRole('heading', { name: 'Sign in to PlacementHub' });
    await actor.type(screen.getByLabelText('Email address'), user.email);
    await actor.type(screen.getByLabelText('Password'), 'wrong-password');
    await actor.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid email or password',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('denies a student access to a recruiter route', async () => {
    renderApp('/recruiter/account', async (url) =>
      response(url.endsWith('/refresh') ? { accessToken: 'token' } : { user }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Access restricted' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Sign out' }),
    ).not.toBeInTheDocument();
  });

  it('allows an existing admin through the admin guard without provisioning an account', async () => {
    renderApp('/admin/account', async (url) =>
      response(
        url.endsWith('/refresh')
          ? { accessToken: 'token' }
          : { user: { ...user, role: 'admin' } },
      ),
    );
    expect(
      await screen.findByRole('heading', { name: /You’re signed in, Asha/ }),
    ).toBeVisible();
  });
});
