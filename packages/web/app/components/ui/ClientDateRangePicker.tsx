'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { formatDate } from '../../lib/format';

export function ClientDateRangePicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  
  const [localFrom, setLocalFrom] = useState<string>(
    fromParam || ''
  );
  const [localTo, setLocalTo] = useState<string>(
    toParam || ''
  );

  useEffect(() => {
    setLocalFrom(fromParam || '');
    setLocalTo(toParam || '');
  }, [fromParam, toParam]);

  const handleFromChange = (value: string) => {
    setLocalFrom(value);
    updateUrl(value, localTo);
  };

  const handleToChange = (value: string) => {
    setLocalTo(value);
    updateUrl(localFrom, value);
  };

  const updateUrl = (from: string, to: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (from) {
      params.set('from', from);
    } else {
      params.delete('from');
    }
    if (to) {
      params.set('to', to);
    } else {
      params.delete('to');
    }
    router.push(`?${params.toString()}`);
  };

  const handleQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const fromStr = start.toISOString().split('T')[0];
    const toStr = end.toISOString().split('T')[0];
    setLocalFrom(fromStr);
    setLocalTo(toStr);
    updateUrl(fromStr, toStr);
  };

  const handleClear = () => {
    setLocalFrom('');
    setLocalTo('');
    updateUrl('', '');
  };

  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="from-date" className="text-sm font-medium">
          From:
        </label>
        <input
          id="from-date"
          type="date"
          value={localFrom}
          onChange={(e) => handleFromChange(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="to-date" className="text-sm font-medium">
          To:
        </label>
        <input
          id="to-date"
          type="date"
          value={localTo}
          onChange={(e) => handleToChange(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => handleQuickRange(7)}
          className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
        >
          7d
        </button>
        <button
          onClick={() => handleQuickRange(30)}
          className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
        >
          30d
        </button>
        <button
          onClick={() => handleQuickRange(90)}
          className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
        >
          90d
        </button>
        {(from || to) && (
          <button
            onClick={handleClear}
            className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      {(from || to) && (
        <span className="text-xs text-muted-foreground">
          {from && formatDate(from)} - {to && formatDate(to)}
        </span>
      )}
    </div>
  );
}

