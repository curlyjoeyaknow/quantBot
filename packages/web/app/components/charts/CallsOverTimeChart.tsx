'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface CallsOverTimeDataPoint {
  date: string;
  calls: number;
  successful: number;
  failed: number;
}

interface CallsOverTimeChartProps {
  data: CallsOverTimeDataPoint[];
}

export function CallsOverTimeChart({ data }: CallsOverTimeChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No data available
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
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="calls"
          stroke="#8884d8"
          strokeWidth={2}
          name="Total Calls"
          dot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="successful"
          stroke="#82ca9d"
          strokeWidth={2}
          name="Successful"
          dot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="failed"
          stroke="#ff7c7c"
          strokeWidth={2}
          name="Failed"
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

