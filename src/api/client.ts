import axios from 'axios';

import { getStoredToken } from '../auth/token';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';
export const AUTH_SESSION_INVALID_EVENT = 'mindwell:auth-session-invalid';
const AUTH_ENDPOINT_ALLOWLIST = ['/auth/login', '/auth/logout', '/auth/me'];
let lastAuthEventAtMs = 0;

export const apiClient = axios.create({
  baseURL,
  timeout: 20000,
});

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status as number | undefined;
    const requestUrl = String(error?.config?.url ?? '');
    const shouldBroadcast =
      status === 401 &&
      !AUTH_ENDPOINT_ALLOWLIST.some((endpoint) => requestUrl.includes(endpoint));

    if (shouldBroadcast && typeof window !== 'undefined') {
      const now = Date.now();
      if (now - lastAuthEventAtMs > 1000) {
        lastAuthEventAtMs = now;
        window.dispatchEvent(
          new CustomEvent(AUTH_SESSION_INVALID_EVENT, {
            detail: { status, url: requestUrl },
          }),
        );
      }
    }

    return Promise.reject(error);
  },
);
