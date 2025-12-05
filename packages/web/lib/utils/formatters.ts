/**
 * Shared formatting utilities for consistent data display across components
 */

/**
 * Formats a date string to a localized date-time string
 * @param dateString - ISO date string or null
 * @returns Formatted date string or 'N/A' if invalid
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleString();
  } catch {
    return dateString;
  }
}

/**
 * Formats a number as currency (USD)
 * @param value - Number to format
 * @param options - Optional formatting options
 * @returns Formatted currency string or 'N/A' if invalid
 */
export function formatCurrency(
  value: number | null | undefined,
  options?: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }
): string {
  if (value === null || value === undefined) return 'N/A';
  
  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  } = options || {};

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/**
 * Formats a number as a percentage with sign
 * @param value - Number to format (e.g., 5.5 for 5.5%)
 * @returns Formatted percentage string with sign or 'N/A' if invalid
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === undefined || value === null) return 'N/A';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Formats a number with standard number formatting
 * @param value - Number to format
 * @param options - Optional formatting options
 * @returns Formatted number string or 'N/A' if invalid
 */
export function formatNumber(
  value: number | null | undefined,
  options?: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }
): string {
  if (value === undefined || value === null) return 'N/A';
  
  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  } = options || {};

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/**
 * Formats a number with abbreviated notation (K, M)
 * @param value - Number to format
 * @returns Abbreviated string (e.g., "$1.5M", "$500K") or 'N/A' if invalid
 */
export function formatAbbreviated(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * Calculates and formats time ago from a date string
 * @param dateString - ISO date string or null
 * @returns Human-readable time ago string (e.g., "5 minutes ago", "2 hours ago")
 */
export function getTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 1000 / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } catch {
    return 'N/A';
  }
}

