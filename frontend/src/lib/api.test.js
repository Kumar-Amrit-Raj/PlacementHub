import { describe, expect, it, vi } from 'vitest';
import { createAuthClient } from './api.js';

const user = {
  id: '1',
  name: 'Asha',
  email: 'asha@example.test',
  role: 'student',
};
const response = (body, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });
function setup(handler) {
  const fetcher = vi.fn(async (url, options) => handler(url, options));
  return { fetcher, client: createAuthClient({ fetcher }) };
}

describe('authentication API client', () => {
  it('restores once under repeated initialization and loads /me with an in-memory token', async () => {
    const { client, fetcher } = setup((url, options) => {
      if (url.endsWith('/refresh')) {
        expect(options.credentials).toBe('include');
        expect(options.headers['X-CSRF-Protection']).toBe('1');
        return response({ accessToken: 'memory-token' });
      }
      expect(options.headers.Authorization).toBe('Bearer memory-token');
      return response({ user });
    });
    await Promise.all([client.initialize(), client.initialize()]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().user).toEqual(user);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('coalesces simultaneous 401s into one refresh and retries with the new access token', async () => {
    let refreshes = 0;
    const { client } = setup((url, options) => {
      if (url.endsWith('/refresh'))
        return response({ accessToken: 'token-' + ++refreshes });
      if (url.endsWith('/me')) return response({ user });
      return options.headers.Authorization === 'Bearer token-1'
        ? response({}, 401)
        : response({ ok: true });
    });
    await client.initialize();
    const results = await Promise.all([
      client.request('/resource'),
      client.request('/resource'),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshes).toBe(2);
  });

  it('does not loop on a second 401 or refresh on a forbidden response', async () => {
    let refreshes = 0;
    const { client } = setup((url) => {
      if (url.endsWith('/refresh'))
        return response({ accessToken: 'token-' + ++refreshes });
      if (url.endsWith('/me')) return response({ user });
      return response({}, url.endsWith('/forbidden') ? 403 : 401);
    });
    await client.initialize();
    await expect(client.request('/forbidden')).rejects.toMatchObject({
      status: 403,
    });
    expect(refreshes).toBe(1);
    await expect(client.request('/expired')).rejects.toMatchObject({
      status: 401,
    });
    expect(refreshes).toBe(2);
    expect(client.getSnapshot().status).toBe('anonymous');
  });

  it('does not automatically retry an uncertain refresh after network failure', async () => {
    const { client, fetcher } = setup(() => {
      throw new Error('offline');
    });
    await client.initialize();
    await client.initialize();
    await expect(client.request('/me')).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot().error).toMatch(/Unable to reach/);
  });

  it('waits for an in-flight refresh before logging out and never restores a logged-out user', async () => {
    let release;
    const calls = [];
    let count = 0;
    const { client } = setup(async (url) => {
      calls.push(url);
      if (url.endsWith('/refresh')) {
        if (++count === 2)
          await new Promise((resolve) => {
            release = resolve;
          });
        return response({ accessToken: 'token-' + count });
      }
      if (url.endsWith('/me')) return response({ user });
      if (url.endsWith('/logout')) return response(null, 204);
      return response({}, 401);
    });
    await client.initialize();
    const request = client.request('/expired').catch(() => {});
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const logout = client.logout();
    release();
    await Promise.all([request, logout]);
    expect(calls.indexOf('/api/v1/auth/logout')).toBeGreaterThan(
      calls.lastIndexOf('/api/v1/auth/refresh'),
    );
    expect(client.getSnapshot().status).toBe('anonymous');
    await expect(client.request('/anything')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('retains visible session and reports an unconfirmed logout rather than claiming success', async () => {
    const { client } = setup((url) => {
      if (url.endsWith('/refresh')) return response({ accessToken: 'token' });
      if (url.endsWith('/me')) return response({ user });
      throw new Error('offline');
    });
    await client.initialize();
    await expect(client.logout()).rejects.toThrow();
    expect(client.getSnapshot().status).toBe('authenticated');
    expect(client.getSnapshot().error).toMatch(/could not be confirmed/);
  });

  it('ignores stale restoration after another tab changes the session', async () => {
    let release;
    const { client } = setup(async (url) => {
      if (url.endsWith('/refresh')) return response({ accessToken: 'old' });
      await new Promise((resolve) => {
        release = resolve;
      });
      return response({ user });
    });
    const startup = client.initialize();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    client.sessionChanged();
    release();
    await startup;
    expect(client.getSnapshot().status).toBe('anonymous');
  });

  it('uses the supplied cross-tab lock for cookie-changing requests', async () => {
    const exclusive = vi.fn((work) => work());
    const client = createAuthClient({
      exclusive,
      fetcher: async () => response({}, 401),
    });
    await client.initialize();
    expect(exclusive).toHaveBeenCalledTimes(1);
  });
});

it('uses a configured backend origin with credentialed refresh and current-user requests', async () => {
  const fetcher = vi.fn(async (url) =>
    response(url.endsWith('/refresh') ? { accessToken: 'fixture' } : { user }),
  );
  const client = createAuthClient({
    apiBaseUrl: 'https://api.example.test/',
    fetcher,
  });
  await client.initialize();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://api.example.test/api/v1/auth/refresh',
    'https://api.example.test/api/v1/auth/me',
  ]);
  expect(
    fetcher.mock.calls.every(
      ([, options]) => options.credentials === 'include',
    ),
  ).toBe(true);
});
