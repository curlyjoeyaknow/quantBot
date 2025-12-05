/**
 * Pagination Utilities
 * ===================
 * Standardized pagination helpers
 */

import { NextRequest } from 'next/server';

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
  links?: {
    first?: string;
    last?: string;
    next?: string;
    prev?: string;
  };
}

/**
 * Parse pagination from request query params
 */
export function parsePagination(request: NextRequest, defaultPageSize: number = 50): PaginationParams {
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(1000, Math.max(1, parseInt(searchParams.get('pageSize') || String(defaultPageSize), 10)));
  
  return { page, pageSize };
}

/**
 * Calculate pagination metadata
 */
export function calculatePaginationMeta(
  page: number,
  pageSize: number,
  total: number
): PaginationMeta {
  const totalPages = Math.ceil(total / pageSize);
  
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Generate pagination links
 */
export function generatePaginationLinks(
  request: NextRequest,
  meta: PaginationMeta
): { first?: string; last?: string; next?: string; prev?: string } {
  const baseUrl = request.nextUrl.origin + request.nextUrl.pathname;
  const searchParams = new URLSearchParams(request.nextUrl.searchParams);
  
  const links: { first?: string; last?: string; next?: string; prev?: string } = {};
  
  // First page
  searchParams.set('page', '1');
  links.first = `${baseUrl}?${searchParams.toString()}`;
  
  // Last page
  searchParams.set('page', String(meta.totalPages));
  links.last = `${baseUrl}?${searchParams.toString()}`;
  
  // Next page
  if (meta.hasNext) {
    searchParams.set('page', String(meta.page + 1));
    links.next = `${baseUrl}?${searchParams.toString()}`;
  }
  
  // Previous page
  if (meta.hasPrev) {
    searchParams.set('page', String(meta.page - 1));
    links.prev = `${baseUrl}?${searchParams.toString()}`;
  }
  
  return links;
}

/**
 * Create paginated response
 */
export function createPaginatedResponse<T>(
  data: T[],
  page: number,
  pageSize: number,
  total: number,
  request: NextRequest
): PaginatedResponse<T> {
  const meta = calculatePaginationMeta(page, pageSize, total);
  const links = generatePaginationLinks(request, meta);
  
  return {
    data,
    meta,
    links,
  };
}

