'use client';

import { useState } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={`absolute z-50 px-2 py-1 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded shadow-lg whitespace-nowrap ${positionClasses[position]}`}
        >
          {content}
          <div
            className={`absolute w-2 h-2 bg-gray-900 dark:bg-gray-700 ${
              position === 'top'
                ? 'top-full left-1/2 -translate-x-1/2 rotate-45'
                : position === 'bottom'
                  ? 'bottom-full left-1/2 -translate-x-1/2 rotate-45'
                  : position === 'left'
                    ? 'left-full top-1/2 -translate-y-1/2 rotate-45'
                    : 'right-full top-1/2 -translate-y-1/2 rotate-45'
            }`}
          />
        </div>
      )}
    </div>
  );
}

