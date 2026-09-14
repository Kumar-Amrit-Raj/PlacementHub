export class ApiError extends Error {
  constructor(message, status = 0, details = [], eligibility) {
    super(message);
    this.status = status;
    this.details = details;
    this.eligibility = eligibility;
  }
}

export function createAuthClient({
  apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '',
  fetcher = (...args) => fetch(...args),
  exclusive = (work) => work(),
  notify = () => {},
} = {}) {
  let accessToken = null;
  let snapshot = { status: 'loading', user: null, error: null, busy: false };
  let startup;
  let refreshFlight;
  let queue = Promise.resolve();
  let generation = 0;
  const listeners = new Set();
  const publish = (next) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };
  const clear = (error = null) => {
    accessToken = null;
    generation++;
    publish({ status: 'anonymous', user: null, error, busy: false });
  };
  const serialized = (work) => {
    const task = queue.then(() => exclusive(work));
    queue = task.catch(() => {});
    return task;
  };

  async function send(
    path,
    { method = 'GET', body, token, session = false } = {},
  ) {
    let response;
    try {
      response = await fetcher(
        apiBaseUrl.replace(/\/$/, '') + '/api/v1' + path,
        {
          method,
          credentials: 'include',
          headers: {
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
            ...(session ? { 'X-CSRF-Protection': '1' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
      );
    } catch {
      throw new ApiError(
        'Unable to reach the server. Check your connection and try signing in again.',
      );
    }
    const data =
      response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        data?.error || 'The request failed. Please try again.',
        response.status,
        data?.details,
        data?.eligibility,
      );
    return data;
  }

  async function accept(result, expectedGeneration) {
    // /me is the source of current user details, not decoded JWT claims.
    const current = await send('/auth/me', { token: result.accessToken });
    if (generation !== expectedGeneration)
      throw new ApiError('Your session changed. Please sign in again.', 401);
    accessToken = result.accessToken;
    publish({
      status: 'authenticated',
      user: current.user,
      error: null,
      busy: false,
    });
  }

  function refresh() {
    if (!refreshFlight) {
      const expectedGeneration = generation;
      refreshFlight = serialized(async () => {
        if (generation !== expectedGeneration)
          throw new ApiError('Your session changed.', 401);
        try {
          const result = await send('/auth/refresh', {
            method: 'POST',
            session: true,
          });
          await accept(result, expectedGeneration);
        } catch (error) {
          if (generation === expectedGeneration) {
            clear(error.status === 401 ? null : error.message);
          }
          throw error;
        }
      }).finally(() => {
        refreshFlight = null;
      });
    }
    return refreshFlight;
  }

  async function credentials(kind, body) {
    return serialized(async () => {
      const expectedGeneration = ++generation;
      publish({ busy: true, error: null });
      try {
        const result = await send('/auth/' + kind, { method: 'POST', body });
        await accept(result, expectedGeneration);
        notify();
      } catch (error) {
        if (generation === expectedGeneration) clear(error.message);
        throw error;
      }
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    initialize() {
      startup ??= refresh().catch(() => {});
      return startup;
    },
    login: (body) => credentials('login', body),
    register: (body) => credentials('register', body),
    async request(path, options = {}) {
      if (!accessToken) throw new ApiError('Please sign in to continue.', 401);
      const usedToken = accessToken;
      const startedGeneration = generation;
      try {
        return await send(path, { ...options, token: usedToken });
      } catch (error) {
        if (error.status !== 401) throw error;
        if (startedGeneration !== generation || !accessToken) throw error;
        if (accessToken === usedToken) await refresh();
        const retryGeneration = generation;
        try {
          return await send(path, { ...options, token: accessToken });
        } catch (retryError) {
          if (retryError.status === 401 && generation === retryGeneration)
            clear('Your session expired. Please sign in again.');
          throw retryError;
        }
      }
    },
    logout() {
      return serialized(async () => {
        publish({ busy: true, error: null });
        try {
          await send('/auth/logout', { method: 'POST', session: true });
          clear();
          notify();
        } catch (error) {
          publish({
            busy: false,
            error:
              'Sign out could not be confirmed. Check your connection and try again.',
          });
          throw error;
        }
      });
    },
    sessionChanged() {
      clear('Your session changed in another tab. Please sign in again.');
    },
  };
}
