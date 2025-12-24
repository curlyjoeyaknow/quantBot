'use client';

interface ExportButtonProps {
  data: unknown[];
  filename: string;
  format?: 'csv' | 'json';
  className?: string;
}

export function ExportButton({
  data,
  filename,
  format = 'csv',
  className = '',
}: ExportButtonProps) {
  const exportToCSV = () => {
    if (data.length === 0) return;

    const headers = Object.keys(data[0] as Record<string, unknown>);
    const csvContent = [
      headers.join(','),
      ...data.map((row) =>
        headers
          .map((header) => {
            const value = (row as Record<string, unknown>)[header];
            // Escape commas and quotes in CSV
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
  };

  const exportToJSON = () => {
    const jsonContent = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.json`;
    link.click();
  };

  const handleExport = () => {
    if (format === 'csv') {
      exportToCSV();
    } else {
      exportToJSON();
    }
  };

  if (data.length === 0) {
    return null;
  }

  return (
    <button
      onClick={handleExport}
      className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-muted transition-colors ${className}`}
      title={`Export as ${format.toUpperCase()}`}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      Export {format.toUpperCase()}
    </button>
  );
}

