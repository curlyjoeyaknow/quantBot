'use client';

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface LineChartProps {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  xKey: string;
  lines: Array<{
    key: string;
    name: string;
    color?: string;
  }>;
  height?: number;
}

export function LineChart({ data, dataKey, xKey, lines, height = 300 }: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Legend />
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.name}
            stroke={line.color || 'hsl(var(--primary))'}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}

