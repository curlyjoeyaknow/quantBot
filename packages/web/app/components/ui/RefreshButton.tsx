'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface RefreshButtonProps {
  className?: string;
}

export function RefreshButton({ className = '' }: RefreshButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const router = useRouter();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    router.refresh();
    // Add a small delay for visual feedback
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={isRefreshing}
      className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-muted transition-colors disabled:opacity-50 ${className}`}
      title="Refresh data"
    >
      <svg
        className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      {isRefreshing ? 'Refreshing...' : 'Refresh'}
    </button>
  );
}

