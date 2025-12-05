/**
 * Toast notification utilities
 * Wrapper around sonner for consistent toast usage
 */

import { toast as sonnerToast } from 'sonner';

/**
 * Show a success toast
 */
export function toastSuccess(message: string, description?: string) {
  return sonnerToast.success(message, {
    description,
    duration: 3000,
  });
}

/**
 * Show an error toast
 */
export function toastError(message: string, description?: string) {
  return sonnerToast.error(message, {
    description,
    duration: 5000,
  });
}

/**
 * Show an info toast
 */
export function toastInfo(message: string, description?: string) {
  return sonnerToast.info(message, {
    description,
    duration: 3000,
  });
}

/**
 * Show a warning toast
 */
export function toastWarning(message: string, description?: string) {
  return sonnerToast.warning(message, {
    description,
    duration: 4000,
  });
}

/**
 * Show a loading toast that can be updated
 */
export function toastLoading(message: string) {
  return sonnerToast.loading(message);
}

/**
 * Update a loading toast to success/error
 */
export function toastUpdate(
  toastId: string | number,
  type: 'success' | 'error' | 'info',
  message: string,
  description?: string
) {
  return sonnerToast[type](message, {
    id: toastId,
    description,
  });
}

// Re-export toast for direct access if needed
export { toast as toastDefault } from 'sonner';

