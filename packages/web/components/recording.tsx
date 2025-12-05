'use client';

import { useState } from 'react';
import { useRecording } from '@/lib/hooks/use-recording';
import { formatDate, getTimeAgo } from '@/lib/utils/formatters';
import { RecordingData } from '@/lib/types';

export function Recording() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { data, isLoading } = useRecording({ enabled: autoRefresh });

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Recording Status</h2>
            <p className="text-slate-400 text-sm">System recording status and database statistics</p>
          </div>
          <label className="flex items-center gap-2 text-slate-300 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
              aria-label="Enable auto-refresh every 30 seconds"
            />
            Auto-refresh (30s)
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="text-white p-8 text-center">Loading recording status...</div>
      ) : data ? (
        <>
          {/* Recording Status Card */}
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="flex items-center gap-4">
              <div 
                className={`w-4 h-4 rounded-full ${data.recording.active ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}
                aria-label={`Recording is ${data.recording.active ? 'active' : 'inactive'}`}
                role="status"
              ></div>
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Recording {data.recording.active ? 'Active' : 'Inactive'}
                </h3>
                <p className="text-slate-400 text-sm">
                  Last tick: {getTimeAgo(data.recording.lastTickTime)}
                </p>
              </div>
            </div>
          </div>

          {/* Database Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm mb-1">Total Alerts</div>
              <div className="text-2xl font-bold text-white">{data.database.totalAlerts.toLocaleString()}</div>
              <div className="text-xs text-slate-500 mt-1">
                Recent (1h): {data.database.recentAlerts}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm mb-1">Total Callers</div>
              <div className="text-2xl font-bold text-white">{data.database.totalCallers}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm mb-1">Total Tokens</div>
              <div className="text-2xl font-bold text-white">{data.database.totalTokens.toLocaleString()}</div>
            </div>
          </div>

          {/* ClickHouse Statistics */}
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <h3 className="text-lg font-semibold text-white mb-4">ClickHouse OHLCV Data</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-slate-400 text-sm mb-1">Total Ticks</div>
                <div className="text-2xl font-bold text-white">{data.clickhouse.totalTicks.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-slate-400 text-sm mb-1">Last Tick Time</div>
                <div className="text-white">{formatDate(data.clickhouse.lastTickTime)}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {getTimeAgo(data.clickhouse.lastTickTime)}
                </div>
              </div>
            </div>
          </div>

          {/* Date Range */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h3 className="text-lg font-semibold text-white mb-2">Recording Date Range</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-slate-400 mb-1">Earliest Alert</div>
                <div className="text-white">{formatDate(data.database.earliestAlert)}</div>
              </div>
              <div>
                <div className="text-slate-400 mb-1">Latest Alert</div>
                <div className="text-white">{formatDate(data.database.latestAlert)}</div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="text-white p-8 text-center">No recording data available</div>
      )}
    </div>
  );
}

