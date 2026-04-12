const TOKEN_STORAGE_KEY = 'mindwell_access_token';

export const getStoredToken = (): string | null => localStorage.getItem(TOKEN_STORAGE_KEY);

export const setStoredToken = (token: string): void => {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
};

export const clearStoredToken = (): void => {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
};

