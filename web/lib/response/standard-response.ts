/**
 * Standard Response Format
 * ========================
 * Consistent API response structure
 */

import { NextResponse, NextRequest } from 'next/server';
import { createPaginatedResponse, PaginatedResponse } from '../utils/pagination';

/**
 * Standard success response envelope
 */
export interface ApiSuccessResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
    hasNext?: boolean;
    hasPrev?: boolean;
    timestamp: string;
    [key: string]: any;
  };
  links?: {
    first?: string;
    last?: string;
    next?: string;
    prev?: string;
  };
}

/**
 * Standard error response envelope
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    path?: string;
    requestId?: string;
  };
}

/**
 * Create a standard success response
 */
export function successResponse<T>(
  data: T,
  status: number = 200,
  metadata?: Record<string, any>
): NextResponse<ApiSuccessResponse<T>> {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...metadata,
    },
  };
  return NextResponse.json(response, { status });
}

/**
 * Create an error response
 */
export function errorResponse(
  message: string,
  status: number = 500,
  details?: any,
  requestId?: string,
  path?: string
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'ERROR',
        message,
        details,
        timestamp: new Date().toISOString(),
        path,
        requestId,
      },
    },
    { status }
  );
}

/**
 * Create a paginated response with links
 */
export function paginatedResponse<T>(
  data: T[],
  page: number,
  pageSize: number,
  total: number,
  request: NextRequest,
  status: number = 200,
  additionalMetadata?: Record<string, any>
): NextResponse<ApiSuccessResponse<T[]>> {
  const paginated = createPaginatedResponse(data, page, pageSize, total, request);
  
  const response: ApiSuccessResponse<T[]> = {
    success: true,
    data: paginated.data,
    meta: {
      ...paginated.meta,
      timestamp: new Date().toISOString(),
      ...additionalMetadata,
    },
    links: paginated.links,
  };
  
  return NextResponse.json(response, { status });
}
