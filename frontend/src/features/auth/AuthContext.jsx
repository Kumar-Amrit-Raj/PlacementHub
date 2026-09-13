import PropTypes from 'prop-types';
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';
import { createAuthClient } from '../../lib/api.js';

const AuthContext = createContext(null);
const channel =
  typeof window.BroadcastChannel === 'function'
    ? new BroadcastChannel('placementhub-auth')
    : null;
export const authClient = createAuthClient({
  exclusive: (work) =>
    navigator.locks
      ? navigator.locks.request('placementhub-auth-session', work)
      : work(),
  notify: () => channel?.postMessage('session-changed'),
});
if (channel) channel.onmessage = () => authClient.sessionChanged();

export function AuthProvider({ children, client = authClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  useEffect(() => {
    void client.initialize();
  }, [client]);
  return (
    <AuthContext.Provider value={{ ...state, client }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth requires AuthProvider.');
  return auth;
}

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
  client: PropTypes.object,
};
