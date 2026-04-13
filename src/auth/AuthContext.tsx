import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AUTH_SESSION_INVALID_EVENT } from '../api/client';
import { authApi } from '../api/services';
import { clearStoredToken, getStoredToken, setStoredToken } from './token';
import type { User } from '../types/domain';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isInitializing: boolean;
  initializationError: string | null;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  retryInitialization: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_LOG_PREFIX = '[MindWell][Auth]';

const resolveStatusCode = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return null;
  }
  const response = (error as { response?: { status?: number } }).response;
  return response?.status ?? null;
};

const toAuthMessage = (error: unknown): string => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_NETWORK'
  ) {
    return 'Cannot reach the API server while restoring your session.';
  }
  const status = resolveStatusCode(error);
  if (status === 401 || status === 403) {
    return 'Your session has expired. Please sign in again.';
  }
  if (status && status >= 500) {
    return 'MindWell API is temporarily unavailable. Please retry.';
  }
  return 'Unable to validate your session right now.';
};

const logAuth = (stage: string, payload?: unknown): void => {
  if (!import.meta.env.DEV) return;
  if (payload !== undefined) {
    console.info(`${AUTH_LOG_PREFIX} ${stage}`, payload);
    return;
  }
  console.info(`${AUTH_LOG_PREFIX} ${stage}`);
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const authRunRef = useRef(0);

  const clearLocalSession = useCallback((reason: string) => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setInitializationError(null);
    logAuth('session-cleared', { reason });
  }, []);

  const refreshUser = useCallback(async () => {
    logAuth('refresh-user:start');
    const current = await authApi.me();
    setUser(current);
    setInitializationError(null);
    logAuth('refresh-user:success', { userId: current.id, role: current.role });
  }, []);

  const signOut = useCallback(async () => {
    const runId = ++authRunRef.current;
    logAuth('sign-out:start', { hasToken: Boolean(token), runId });
    try {
      if (token) {
        await authApi.logout();
      }
    } catch {
      // token may already be invalid; continue clearing local state
    } finally {
      if (runId !== authRunRef.current) {
        return;
      }
      clearLocalSession('sign-out');
      setIsInitializing(false);
      logAuth('sign-out:complete', { runId });
    }
  }, [token, clearLocalSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const runId = ++authRunRef.current;
    logAuth('sign-in:start', { email: email.trim().toLowerCase(), runId });
    const response = await authApi.signIn({ email, password });
    if (runId !== authRunRef.current) {
      return response.user;
    }
    setStoredToken(response.access_token);
    setToken(response.access_token);
    setUser(response.user);
    setInitializationError(null);
    setIsInitializing(false);
    logAuth('sign-in:success', { userId: response.user.id, role: response.user.role, runId });
    return response.user;
  }, []);

  const bootstrapSession = useCallback(
    async (reason: string) => {
      const runId = ++authRunRef.current;
      setIsInitializing(true);
      setInitializationError(null);

      const existingToken = getStoredToken();
      logAuth('bootstrap:start', { reason, hasToken: Boolean(existingToken), runId });

      if (!existingToken) {
        if (runId !== authRunRef.current) return;
        setToken(null);
        setUser(null);
        setIsInitializing(false);
        logAuth('bootstrap:no-token', { runId });
        return;
      }

      setToken(existingToken);
      try {
        const current = await authApi.me();
        if (runId !== authRunRef.current) return;
        setUser(current);
        setInitializationError(null);
        logAuth('bootstrap:success', { userId: current.id, role: current.role, runId });
      } catch (error) {
        if (runId !== authRunRef.current) return;
        const status = resolveStatusCode(error);
        if (status === 401 || status === 403) {
          clearLocalSession('bootstrap-invalid-token');
          logAuth('bootstrap:invalid-token', { status, runId });
        } else {
          const message = toAuthMessage(error);
          setUser(null);
          setInitializationError(message);
          logAuth('bootstrap:recoverable-failure', { message, status, runId });
          console.error(`${AUTH_LOG_PREFIX} bootstrap failure`, error);
        }
      } finally {
        if (runId === authRunRef.current) {
          setIsInitializing(false);
        }
      }
    },
    [clearLocalSession],
  );

  const retryInitialization = useCallback(async () => {
    await bootstrapSession('manual-retry');
  }, [bootstrapSession]);

  useEffect(() => {
    void bootstrapSession('startup');
  }, [bootstrapSession]);

  useEffect(() => {
    const onSessionInvalid = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: number; url?: string }>).detail;
      ++authRunRef.current;
      clearLocalSession('api-interceptor');
      setIsInitializing(false);
      logAuth('session-invalid-event', detail);
    };

    window.addEventListener(AUTH_SESSION_INVALID_EVENT, onSessionInvalid as EventListener);
    return () => window.removeEventListener(AUTH_SESSION_INVALID_EVENT, onSessionInvalid as EventListener);
  }, [clearLocalSession]);

  const value = useMemo(
    () => ({
      user,
      token,
      isInitializing,
      initializationError,
      signIn,
      signOut,
      refreshUser,
      retryInitialization,
    }),
    [user, token, isInitializing, initializationError, signIn, signOut, refreshUser, retryInitialization],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
