'use client';

import { useState } from 'react';
import { formatDate } from '../../lib/format';

interface DateRangePickerProps {
  from?: Date;
  to?: Date;
  onRangeChange: (from: Date | undefined, to: Date | undefined) => void;
}

export function DateRangePicker({ from, to, onRangeChange }: DateRangePickerProps) {
  const [localFrom, setLocalFrom] = useState<string>(
    from ? from.toISOString().split('T')[0] : ''
  );
  const [localTo, setLocalTo] = useState<string>(
    to ? to.toISOString().split('T')[0] : ''
  );

  const handleFromChange = (value: string) => {
    setLocalFrom(value);
    onRangeChange(value ? new Date(value) : undefined, to);
  };

  const handleToChange = (value: string) => {
    setLocalTo(value);
    onRangeChange(from, value ? new Date(value) : undefined);
  };

  const handleQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setLocalFrom(start.toISOString().split('T')[0]);
    setLocalTo(end.toISOString().split('T')[0]);
    onRangeChange(start, end);
  };

  const handleClear = () => {
    setLocalFrom('');
    setLocalTo('');
    onRangeChange(undefined, undefined);
  };

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
        <button
          onClick={handleClear}
          className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
        >
          Clear
        </button>
      </div>
      {(from || to) && (
        <span className="text-xs text-muted-foreground">
          {from && formatDate(from)} - {to && formatDate(to)}
        </span>
      )}
    </div>
  );
}

