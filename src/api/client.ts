import axios from 'axios';

import { getStoredToken } from '../auth/token';

const normalizeBaseUrl = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
};

const environmentBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
const defaultRelativeBaseUrl = '/api/v1';
const devFallbackBaseUrls = import.meta.env.DEV
  ? [
      'http://127.0.0.1:8000/api/v1',
      'http://localhost:8000/api/v1',
      'http://127.0.0.1:8010/api/v1',
      'http://localhost:8010/api/v1',
    ]
  : [];

const candidateBaseUrls = Array.from(
  new Set(
    [environmentBaseUrl, defaultRelativeBaseUrl, ...devFallbackBaseUrls].filter(
      (value): value is string => Boolean(value),
    ),
  ),
);

let activeBaseUrl = candidateBaseUrls[0] ?? defaultRelativeBaseUrl;
export const AUTH_SESSION_INVALID_EVENT = 'mindwell:auth-session-invalid';
const AUTH_ENDPOINT_ALLOWLIST = ['/auth/login', '/auth/logout', '/auth/me'];
let lastAuthEventAtMs = 0;

export const apiClient = axios.create({
  baseURL: activeBaseUrl,
  timeout: 20000,
});

apiClient.interceptors.request.use((config) => {
  if (!config.baseURL) {
    config.baseURL = activeBaseUrl;
  }
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status as number | undefined;
    const requestUrl = String(error?.config?.url ?? '');
    const requestConfig = (error?.config ?? {}) as {
      baseURL?: string;
      __mindwellTriedBaseUrls?: string[];
    };
    const isNetworkError = !status && (error?.code === 'ERR_NETWORK' || /network error/i.test(String(error?.message)));

    if (isNetworkError && requestConfig) {
      const triedBaseUrls = new Set<string>(
        requestConfig.__mindwellTriedBaseUrls ?? [requestConfig.baseURL ?? activeBaseUrl],
      );

      for (const candidateBaseUrl of candidateBaseUrls) {
        if (triedBaseUrls.has(candidateBaseUrl)) {
          continue;
        }

        requestConfig.baseURL = candidateBaseUrl;
        requestConfig.__mindwellTriedBaseUrls = [...triedBaseUrls, candidateBaseUrl];
        activeBaseUrl = candidateBaseUrl;

        if (import.meta.env.DEV) {
          console.warn(`[MindWell][API] Network retry using base URL: ${candidateBaseUrl}`);
        }

        return apiClient.request(requestConfig);
      }
    }

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
