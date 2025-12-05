/**
 * Reusable error display component with retry functionality
 */

interface ErrorDisplayProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorDisplay({
  title = 'Something went wrong',
  message,
  onRetry,
  className = '',
}: ErrorDisplayProps) {
  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center ${className}`}>
      <div className="mb-4 text-red-400 text-4xl" aria-hidden="true">
        ⚠️
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-red-400 mb-4 max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600 font-medium"
          aria-label="Retry"
        >
          Retry
        </button>
      )}
    </div>
  );
}

