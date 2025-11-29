'use client';

import { ErrorBoundary } from './error-boundary';
import { Toaster } from 'sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './theme-provider';
import { useState } from 'react';

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * Root providers component wrapping the app with error boundaries, toast notifications, and React Query
 */
export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
            retry: 1,
            retryDelay: 1000,
          },
        },
      })
  );

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster 
            position="top-right"
            richColors
            closeButton
            toastOptions={{
              style: {
                background: 'rgb(30 41 59)',
                color: 'rgb(248 250 252)',
                border: '1px solid rgb(51 65 85)',
              },
            }}
          />
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

