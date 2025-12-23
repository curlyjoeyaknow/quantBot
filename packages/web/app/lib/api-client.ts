/**
 * Type-safe API client utilities
 * 
 * For Next.js App Router:
 * - Server components: Should call services directly (not use fetchApi)
 * - Client components: Use fetchApi with NEXT_PUBLIC_API_URL or relative URL
 * 
 * NOTE: fetchApi is primarily for client components.
 * Server components should import and call services directly from './services/'
 */

import { ApiError } from '@quantbot/utils';
import { headers } from 'next/headers';

async function getBaseUrl(): Promise<string> {
  // In server components, construct URL from headers
  if (typeof window === 'undefined') {
    try {
      const headersList = await headers();
      const host = headersList.get('host');
      const protocol = headersList.get('x-forwarded-proto') || 'http';
      if (host) {
        return `${protocol}://${host}`;
      }
    } catch {
      // If headers() fails (e.g., during build), fall back to environment variable
    }
    // Fallback to environment variable or localhost
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  }
  // Client-side: use the public API URL or relative URL
  return process.env.NEXT_PUBLIC_API_URL || '';
}

export async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const baseUrl = await getBaseUrl();
  // Use absolute URL for server components, relative for client components
  const url = baseUrl && typeof window === 'undefined' 
    ? `${baseUrl}${endpoint}` 
    : endpoint;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      message: `HTTP error! status: ${response.status}`,
    }));
    throw new ApiError(
      error.message || `HTTP error! status: ${response.status}`,
      url,
      response.status,
      error
    );
  }

  return response.json();
}

export async function getApiUrl(endpoint: string): Promise<string> {
  const baseUrl = await getBaseUrl();
  return baseUrl ? `${baseUrl}${endpoint}` : endpoint;
}
