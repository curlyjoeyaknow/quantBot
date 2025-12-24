'use client';

import { useState } from 'react';
import { Badge } from './Badge';
import { formatPercent, formatMultiple } from '../../lib/format';

interface ComparisonItem {
  id: string;
  name: string;
  metrics: {
    totalCalls: number;
    winRate: number;
    avgMultiple: number;
    bestMultiple: number;
    worstMultiple: number;
  };
}

interface ComparisonViewProps {
  items: ComparisonItem[];
  title?: string;
}

export function ComparisonView({ items, title = 'Comparison' }: ComparisonViewProps) {
  const [selectedItems, setSelectedItems] = useState<string[]>(items.slice(0, 3).map((i) => i.id));

  const toggleItem = (id: string) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selected = items.filter((item) => selectedItems.includes(item.id));

  if (selected.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        <p className="text-muted-foreground">Select items to compare</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => toggleItem(item.id)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                selectedItems.includes(item.id)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'hover:bg-muted'
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Metric</th>
              {selected.map((item) => (
                <th key={item.id} className="text-right p-2">
                  {item.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="p-2 font-medium">Total Calls</td>
              {selected.map((item) => (
                <td key={item.id} className="text-right p-2">
                  {item.metrics.totalCalls.toLocaleString()}
                </td>
              ))}
            </tr>
            <tr className="border-b">
              <td className="p-2 font-medium">Win Rate</td>
              {selected.map((item) => (
                <td key={item.id} className="text-right p-2">
                  {formatPercent(item.metrics.winRate)}
                </td>
              ))}
            </tr>
            <tr className="border-b">
              <td className="p-2 font-medium">Avg Multiple</td>
              {selected.map((item) => (
                <td key={item.id} className="text-right p-2 font-semibold">
                  {formatMultiple(item.metrics.avgMultiple)}
                </td>
              ))}
            </tr>
            <tr className="border-b">
              <td className="p-2 font-medium">Best Multiple</td>
              {selected.map((item) => (
                <td key={item.id} className="text-right p-2 text-green-600 dark:text-green-400">
                  {formatMultiple(item.metrics.bestMultiple)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-2 font-medium">Worst Multiple</td>
              {selected.map((item) => (
                <td key={item.id} className="text-right p-2 text-red-600 dark:text-red-400">
                  {formatMultiple(item.metrics.worstMultiple)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

