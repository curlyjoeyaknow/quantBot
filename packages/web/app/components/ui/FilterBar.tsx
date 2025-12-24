'use client';

import { ReactNode } from 'react';

interface FilterBarProps {
  children: ReactNode;
  className?: string;
}

export function FilterBar({ children, className = '' }: FilterBarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-4 p-4 rounded-lg border bg-muted/30 ${className}`}>
      {children}
    </div>
  );
}

