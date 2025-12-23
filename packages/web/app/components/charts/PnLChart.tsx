'use client';

import { LineChart } from './LineChart';

interface SimulationEvent {
  event_time: string;
  pnl_so_far: number;
  event_type: string;
}

interface PnLChartProps {
  events: SimulationEvent[];
}

export function PnLChart({ events }: PnLChartProps) {
  if (events.length === 0) {
    return <p className="text-muted-foreground">No events available</p>;
  }

  const data = events.map((event) => ({
    time: new Date(event.event_time).toLocaleTimeString(),
    pnl: event.pnl_so_far,
    type: event.event_type,
  }));

  return (
    <LineChart
      data={data}
      dataKey="pnl"
      xKey="time"
      lines={[
        {
          key: 'pnl',
          name: 'Cumulative PnL',
          color: 'hsl(var(--primary))',
        },
      ]}
      height={400}
    />
  );
}

