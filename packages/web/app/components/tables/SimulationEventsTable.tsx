'use client';

import { formatDate, formatNumber } from '../../lib/format';

interface SimulationEvent {
  simulation_run_id: number;
  token_address: string;
  chain: string;
  event_time: string;
  seq: number;
  event_type: string;
  price: number;
  size: number;
  remaining_position: number;
  pnl_so_far: number;
  indicators: unknown;
  positionState: unknown;
  metadata: unknown;
}

interface SimulationEventsTableProps {
  events: SimulationEvent[];
}

export function SimulationEventsTable({ events }: SimulationEventsTableProps) {
  if (events.length === 0) {
    return <p className="text-muted-foreground">No events available</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left p-2">Time</th>
            <th className="text-left p-2">Type</th>
            <th className="text-left p-2">Token</th>
            <th className="text-right p-2">Price</th>
            <th className="text-right p-2">Size</th>
            <th className="text-right p-2">Remaining Position</th>
            <th className="text-right p-2">PnL So Far</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={index} className="border-b hover:bg-muted/50">
              <td className="p-2 text-xs">{formatDate(event.event_time)}</td>
              <td className="p-2">
                <span className="px-2 py-1 rounded bg-muted text-xs">
                  {event.event_type}
                </span>
              </td>
              <td className="p-2 font-mono text-xs">
                {event.token_address.substring(0, 8)}...
              </td>
              <td className="text-right p-2">{formatNumber(event.price)}</td>
              <td className="text-right p-2">{formatNumber(event.size)}</td>
              <td className="text-right p-2">
                {formatNumber(event.remaining_position)}
              </td>
              <td className="text-right p-2">{formatNumber(event.pnl_so_far)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

