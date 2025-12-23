'use client';

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface BarChartProps {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  xKey: string;
  bars: Array<{
    key: string;
    name: string;
    color?: string;
  }>;
  height?: number;
}

export function BarChart({ data, dataKey, xKey, bars, height = 300 }: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Legend />
        {bars.map((bar) => (
          <Bar
            key={bar.key}
            dataKey={bar.key}
            name={bar.name}
            fill={bar.color || 'hsl(var(--primary))'}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

