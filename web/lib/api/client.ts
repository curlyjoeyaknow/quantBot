/**
 * API Client abstraction with retry logic, timeouts, and error handling
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { CONSTANTS } from '../constants';
import { ApiError } from '../types';

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: CONSTANTS.FRONTEND.API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Add timestamp to prevent caching
    if (config.method === 'get') {
      config.params = {
        ...(config.params || {}),
        _t: Date.now(),
      };
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { 
      _retry?: boolean;
      _retryCount?: number;
    };

    // Don't retry if request was cancelled
    if (axios.isCancel(error)) {
      return Promise.reject(error);
    }

    // Don't retry if already retried or no config
    if (!originalRequest || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Retry logic for network errors or 5xx errors
    const shouldRetry =
      (!error.response || (error.response.status >= 500 && error.response.status < 600)) &&
      !originalRequest._retry;

    if (shouldRetry) {
      originalRequest._retry = true;

      // Exponential backoff
      const retryCount = originalRequest._retryCount || 0;
      if (retryCount < CONSTANTS.FRONTEND.MAX_RETRIES) {
        const delay = CONSTANTS.FRONTEND.RETRY_DELAY * Math.pow(2, retryCount);
        originalRequest._retryCount = retryCount + 1;

        await new Promise((resolve) => setTimeout(resolve, delay));

        return apiClient(originalRequest);
      }
    }

    // Format error for consistent handling
    const apiError: ApiError = {
      error: error.response?.data?.error || error.message || 'An unexpected error occurred',
      message: error.response?.data?.message,
      statusCode: error.response?.status,
    };

    return Promise.reject(apiError);
  }
);

/**
 * Creates a cancel token source for request cancellation
 */
export function createCancelToken() {
  return axios.CancelToken.source();
}

/**
 * Checks if an error is a cancellation error
 */
export function isCancelError(error: unknown): boolean {
  return axios.isCancel(error);
}

/**
 * API Client with retry, timeout, and error handling
 */
export const api = {
  /**
   * GET request
   */
  get: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    return apiClient.get<T>(url, config).then((response) => response.data);
  },

  /**
   * POST request
   */
  post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> => {
    return apiClient.post<T>(url, data, config).then((response) => response.data);
  },

  /**
   * PUT request
   */
  put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> => {
    return apiClient.put<T>(url, data, config).then((response) => response.data);
  },

  /**
   * DELETE request
   */
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    return apiClient.delete<T>(url, config).then((response) => response.data);
  },

  /**
   * PATCH request
   */
  patch: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> => {
    return apiClient.patch<T>(url, data, config).then((response) => response.data);
  },
};

export default api;

