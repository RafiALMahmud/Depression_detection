import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { authApi } from '../api/services';
import { clearStoredToken, getStoredToken, setStoredToken } from './token';
import type { User } from '../types/domain';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isInitializing: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    const current = await authApi.me();
    setUser(current);
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (token) {
        await authApi.logout();
      }
    } catch {
      // token may already be invalid; continue clearing local state
    } finally {
      clearStoredToken();
      setToken(null);
      setUser(null);
    }
  }, [token]);

  const signIn = useCallback(async (email: string, password: string) => {
    const response = await authApi.signIn({ email, password });
    setStoredToken(response.access_token);
    setToken(response.access_token);
    setUser(response.user);
    return response.user;
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const existingToken = getStoredToken();
      if (!existingToken) {
        setIsInitializing(false);
        return;
      }
      try {
        setToken(existingToken);
        await refreshUser();
      } catch {
        clearStoredToken();
        setToken(null);
        setUser(null);
      } finally {
        setIsInitializing(false);
      }
    };

    void bootstrap();
  }, [refreshUser]);

  const value = useMemo(
    () => ({
      user,
      token,
      isInitializing,
      signIn,
      signOut,
      refreshUser,
    }),
    [user, token, isInitializing, signIn, signOut, refreshUser],
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

