'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { AthDistribution } from '../../lib/types';

interface AthDistributionChartProps {
  distribution: AthDistribution[];
}

export function AthDistributionChart({ distribution }: AthDistributionChartProps) {
  if (distribution.length === 0) {
    return <p className="text-muted-foreground">No distribution data available</p>;
  }

  const data = distribution.map((item) => ({
    bucket: item.bucket,
    count: item.count,
    percentage: item.percentage,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="bucket" />
        <YAxis />
        <Tooltip
          formatter={(value: number | undefined) => [value ?? 0, 'Count']}
          labelFormatter={(label) => `Bucket: ${label}`}
        />
        <Bar dataKey="count" fill="#8884d8" />
      </BarChart>
    </ResponsiveContainer>
  );
}

