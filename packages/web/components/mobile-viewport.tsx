'use client';

/**
 * Mobile Viewport Wrapper
 * Forces mobile view for Figma mobile design replicas
 */

interface MobileViewportProps {
  children: React.ReactNode;
  width?: number;
  height?: number;
}

export function MobileViewport({ children, width = 440, height = 956 }: MobileViewportProps) {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="relative bg-white shadow-2xl rounded-lg overflow-hidden" style={{ width: `${width}px`, height: `${height}px` }}>
        <div className="absolute inset-0 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

