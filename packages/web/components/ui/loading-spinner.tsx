/**
 * Reusable loading spinner component
 */

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  className?: string;
}

export function LoadingSpinner({ size = 'md', text, className = '' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div
        className={`inline-block animate-spin rounded-full border-b-2 border-white ${sizeClasses[size]}`}
        role="status"
        aria-label="Loading"
      />
      {text && <p className="mt-4 text-white">{text}</p>}
    </div>
  );
}

