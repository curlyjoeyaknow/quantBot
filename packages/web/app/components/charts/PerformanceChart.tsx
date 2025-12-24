'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface PerformanceDataPoint {
  date: string;
  winRate: number;
  avgMultiple: number;
  totalCalls: number;
}

interface PerformanceChartProps {
  data: PerformanceDataPoint[];
}

export function PerformanceChart({ data }: PerformanceChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No performance data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          angle={-45}
          textAnchor="end"
          height={80}
        />
        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
        <Tooltip
          formatter={(value: number | undefined, name: string | undefined) => {
            if (value === undefined || value === null) {
              return ['-', name || ''];
            }
            const displayName = name || '';
            if (displayName === 'winRate') {
              return [`${(value * 100).toFixed(2)}%`, 'Win Rate'];
            }
            if (displayName === 'avgMultiple') {
              return [`${value.toFixed(2)}x`, 'Avg Multiple'];
            }
            return [value, displayName];
          }}
        />
        <Legend />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="winRate"
          stroke="#8884d8"
          strokeWidth={2}
          name="Win Rate"
          dot={{ r: 3 }}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="avgMultiple"
          stroke="#82ca9d"
          strokeWidth={2}
          name="Avg Multiple"
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

