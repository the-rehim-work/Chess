import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_BASE as string;

export const api = axios.create({
  baseURL: API_BASE,
  headers: { Accept: 'application/json' },
  withCredentials: false,
  validateStatus: (s) => s >= 200 && s < 300,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('jwt');
  if (token) (config.headers as any).Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const resp = error.response;

    const redirectedToLogin =
      (resp?.status === 302 || resp?.status === 301 || resp?.status === 404) &&
      typeof error.request?.responseURL === 'string' &&
      error.request.responseURL.includes('/Account/Login');

    if (redirectedToLogin) {
      const e = new Error('Unauthorized');
      (e as any).status = 401;
      throw e;
    }

    if (resp) {
      const { status, statusText, data, config } = resp;
      let message = `${status} ${statusText || ''}`.trim();

      if (data) {
        if (data.title) message = data.title;
        else if (data.message) message = data.message;
        else if (data.detail) message = data.detail;
        else if (data.errors) {
          const list = Object.values<any>(data.errors).flat();
          message = list.join(', ');
        } else if (typeof data === 'string' && data.trim().length) {
          message = data;
        } else {
          message = `${message} - ${JSON.stringify(data)}`;
        }
      }
      const err = new Error(message);
      (err as any).status = status;
      (err as any).url = config?.url;
      throw err;
    }

    if (error.request) {
      throw new Error('Network error — check your connection');
    }

    throw new Error(error.message || 'Unknown error');
  }
);
