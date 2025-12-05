'use client';

import { useState } from 'react';
import { useHealth } from '@/lib/hooks/use-health';
import { formatDate, getTimeAgo } from '@/lib/utils/formatters';
import { HealthData } from '@/lib/types';

export function Health() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { data, isLoading } = useHealth({ enabled: autoRefresh });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
      case 'healthy':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'offline':
      case 'unhealthy':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'online':
        return 'Online';
      case 'offline':
        return 'Offline';
      case 'degraded':
        return 'Degraded';
      case 'healthy':
        return 'Healthy';
      case 'unhealthy':
        return 'Unhealthy';
      default:
        return status;
    }
  };


  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white mb-2">System Health</h2>
            <p className="text-slate-400 text-sm">Service status and recent activity monitoring</p>
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
        <div className="text-white p-8 text-center">Loading health status...</div>
      ) : data ? (
        <>
          {/* Overall Health Status */}
          <div className={`rounded-lg p-6 border-2 ${data.overallHealth === 'healthy' ? 'bg-green-900/20 border-green-500' : data.overallHealth === 'degraded' ? 'bg-yellow-900/20 border-yellow-500' : 'bg-red-900/20 border-red-500'}`}>
            <div className="flex items-center gap-4">
              <div className={`w-6 h-6 rounded-full ${getStatusColor(data.overallHealth)}`}></div>
              <div>
                <h3 className="text-2xl font-bold text-white">
                  System {getStatusText(data.overallHealth)}
                </h3>
                <p className="text-slate-300 text-sm">
                  {data.services.filter(s => s.status === 'online').length} of {data.services.length} services online
                </p>
              </div>
            </div>
          </div>

          {/* Services Status */}
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <h3 className="text-lg font-semibold text-white mb-4">Services</h3>
            <div className="space-y-3">
              {data.services.map((service) => (
                <div key={service.name} className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div 
                        className={`w-3 h-3 rounded-full ${getStatusColor(service.status)}`}
                        aria-label={`Service ${service.name} is ${getStatusText(service.status)}`}
                        role="status"
                      ></div>
                      <span className="text-white font-medium">{service.name}</span>
                    </div>
                    <span className={`text-sm px-2 py-1 rounded ${service.status === 'online' ? 'bg-green-900/30 text-green-300' : service.status === 'degraded' ? 'bg-yellow-900/30 text-yellow-300' : 'bg-red-900/30 text-red-300'}`}>
                      {getStatusText(service.status)}
                    </span>
                  </div>
                  {service.details && (
                    <div className="mt-2 text-sm text-slate-400 space-y-1">
                      {Object.entries(service.details).map(([key, value]) => (
                        <div key={key} className="flex justify-between">
                          <span className="text-slate-500">{key}:</span>
                          <span className="text-slate-300">
                            {typeof value === 'object' && value !== null
                              ? JSON.stringify(value)
                              : typeof value === 'number'
                              ? value.toLocaleString()
                              : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <h3 className="text-lg font-semibold text-white mb-4">Recent Activity (Last 24 Hours)</h3>
            {data.recentActivity.length > 0 ? (
              <div className="space-y-2">
                {data.recentActivity.map((activity, idx) => (
                  <div key={idx} className="bg-slate-900 rounded-lg p-3 border border-slate-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-white font-medium">
                          {activity.type === 'alert' ? `Alert from ${activity.caller}` : 'Strategy Computation'}
                        </span>
                        {activity.count && (
                          <span className="text-slate-400 text-sm ml-2">
                            ({activity.count} {activity.count === 1 ? 'item' : 'items'})
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 text-sm">
                        {getTimeAgo(activity.timestamp)}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {formatDate(activity.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-400 text-center py-4">No recent activity</div>
            )}
          </div>

          {/* Last Updated */}
          <div className="text-center text-slate-500 text-sm">
            Last updated: {formatDate(data.timestamp)}
          </div>
        </>
      ) : (
        <div className="text-white p-8 text-center">No health data available</div>
      )}
    </div>
  );
}

