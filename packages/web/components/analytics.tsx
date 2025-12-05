'use client';

import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorDisplay } from '@/components/ui/error-display';

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#6366f1', '#f97316'];

interface TimeSeriesData {
  date: string;
  count: number;
}

interface CallerData {
  callerName: string;
  totalAlerts: number;
  uniqueTokens: number;
}

interface TokenDistributionData {
  chain: string;
  count: number;
  percentage: number;
}

interface HourlyActivityData {
  hour: number;
  count: number;
  avgPrice: number;
}

interface TopTokenData {
  symbol: string;
  alertCount: number;
  uniqueCallers: number;
}

interface PriceDistributionData {
  range: string;
  count: number;
}

export function Analytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [alertsTimeSeries, setAlertsTimeSeries] = useState<TimeSeriesData[]>([]);
  const [topCallers, setTopCallers] = useState<CallerData[]>([]);
  const [tokenDistribution, setTokenDistribution] = useState<TokenDistributionData[]>([]);
  const [hourlyActivity, setHourlyActivity] = useState<HourlyActivityData[]>([]);
  const [topTokens, setTopTokens] = useState<TopTokenData[]>([]);
  const [priceDistribution, setPriceDistribution] = useState<PriceDistributionData[]>([]);
  
  const [timeRange, setTimeRange] = useState(30);

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      const [
        alertsRes,
        callersRes,
        distributionRes,
        hourlyRes,
        tokensRes,
        priceRes,
      ] = await Promise.all([
        fetch(`/api/analytics/alerts-timeseries?days=${timeRange}`),
        fetch('/api/analytics/top-callers?limit=10'),
        fetch('/api/analytics/token-distribution'),
        fetch('/api/analytics/hourly-activity'),
        fetch('/api/analytics/top-tokens?limit=10'),
        fetch('/api/analytics/price-distribution'),
      ]);

      const [alerts, callers, distribution, hourly, tokens, price] = await Promise.all([
        alertsRes.json(),
        callersRes.json(),
        distributionRes.json(),
        hourlyRes.json(),
        tokensRes.json(),
        priceRes.json(),
      ]);

      setAlertsTimeSeries(alerts.data || []);
      setTopCallers(callers.data || []);
      setTokenDistribution(distribution.data || []);
      setHourlyActivity(hourly.data || []);
      setTopTokens(tokens.data || []);
      setPriceDistribution(price.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner text="Loading analytics..." className="p-8" />;
  }

  if (error) {
    return <ErrorDisplay message={error} onRetry={loadAnalytics} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white">Analytics Dashboard</h2>
          <p className="text-slate-400">Comprehensive insights into caller activity and token trends</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Time Range:</label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(parseInt(e.target.value))}
            className="bg-slate-700 text-white rounded px-3 py-2 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {/* Alerts Over Time */}
      <Card className="p-6 bg-slate-800 border-slate-700">
        <h3 className="text-xl font-semibold text-white mb-4">Alerts Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={alertsTimeSeries}>
            <defs>
              <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              labelStyle={{ color: '#f1f5f9' }}
            />
            <Area 
              type="monotone" 
              dataKey="count" 
              stroke="#3b82f6" 
              fillOpacity={1} 
              fill="url(#colorCount)"
              name="Alerts"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Top Row: Top Callers & Token Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Callers */}
        <Card className="p-6 bg-slate-800 border-slate-700">
          <h3 className="text-xl font-semibold text-white mb-4">Top Callers</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={topCallers} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis type="number" stroke="#94a3b8" />
              <YAxis dataKey="callerName" type="category" width={120} stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              />
              <Bar dataKey="totalAlerts" fill="#3b82f6" radius={[0, 8, 8, 0]} name="Alerts" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Token Distribution */}
        <Card className="p-6 bg-slate-800 border-slate-700">
          <h3 className="text-xl font-semibold text-white mb-4">Token Distribution by Chain</h3>
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
              <Pie
                data={tokenDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({chain, percentage}) => `${chain}: ${percentage.toFixed(1)}%`}
                outerRadius={120}
                fill="#8884d8"
                dataKey="count"
              >
                {tokenDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Middle Row: Hourly Activity & Top Tokens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hourly Activity */}
        <Card className="p-6 bg-slate-800 border-slate-700">
          <h3 className="text-xl font-semibold text-white mb-4">Hourly Activity Pattern</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={hourlyActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis 
                dataKey="hour" 
                stroke="#94a3b8"
                tickFormatter={(hour) => `${hour}:00`}
              />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                labelFormatter={(hour) => `${hour}:00 UTC`}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="count" 
                stroke="#3b82f6" 
                strokeWidth={2}
                dot={{ fill: '#3b82f6', r: 4 }}
                name="Alert Count"
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Top Tokens */}
        <Card className="p-6 bg-slate-800 border-slate-700">
          <h3 className="text-xl font-semibold text-white mb-4">Top Tokens</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topTokens}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="symbol" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              />
              <Legend />
              <Bar dataKey="alertCount" fill="#3b82f6" radius={[8, 8, 0, 0]} name="Alerts" />
              <Bar dataKey="uniqueCallers" fill="#8b5cf6" radius={[8, 8, 0, 0]} name="Unique Callers" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Price Distribution */}
      <Card className="p-6 bg-slate-800 border-slate-700">
        <h3 className="text-xl font-semibold text-white mb-4">Price Distribution</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={priceDistribution}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="range" stroke="#94a3b8" angle={-45} textAnchor="end" height={100} />
            <YAxis stroke="#94a3b8" />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
            />
            <Bar dataKey="count" fill="#10b981" radius={[8, 8, 0, 0]} name="Token Count" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-slate-800 border-slate-700">
          <div className="text-sm text-slate-400">Total Alerts ({timeRange}d)</div>
          <div className="text-2xl font-bold text-white mt-1">
            {alertsTimeSeries.reduce((sum, d) => sum + d.count, 0).toLocaleString()}
          </div>
        </Card>
        <Card className="p-4 bg-slate-800 border-slate-700">
          <div className="text-sm text-slate-400">Active Callers</div>
          <div className="text-2xl font-bold text-white mt-1">
            {topCallers.length}
          </div>
        </Card>
        <Card className="p-4 bg-slate-800 border-slate-700">
          <div className="text-sm text-slate-400">Unique Tokens</div>
          <div className="text-2xl font-bold text-white mt-1">
            {tokenDistribution.reduce((sum, d) => sum + d.count, 0).toLocaleString()}
          </div>
        </Card>
        <Card className="p-4 bg-slate-800 border-slate-700">
          <div className="text-sm text-slate-400">Peak Hour</div>
          <div className="text-2xl font-bold text-white mt-1">
            {hourlyActivity.length > 0 
              ? `${hourlyActivity.reduce((max, d) => d.count > max.count ? d : max).hour}:00` 
              : 'N/A'
            }
          </div>
        </Card>
      </div>
    </div>
  );
}

