'use client';

import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorDisplay } from '@/components/ui/error-display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#6366f1', '#f97316'];

export function PerformanceAnalytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [topCallersByReturns, setTopCallersByReturns] = useState<any[]>([]);
  const [highestMultipleCalls, setHighestMultipleCalls] = useState<any[]>([]);
  const [strategyComparison, setStrategyComparison] = useState<any[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');

  useEffect(() => {
    loadPerformanceData();
  }, []);

  const loadPerformanceData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [topReturnsRes, highestMultipleRes, strategyCompRes] = await Promise.all([
        fetch('/api/analytics/performance/top-returns?limit=10'),
        fetch('/api/analytics/performance/highest-multiple?limit=10'),
        fetch('/api/analytics/performance/strategy-comparison'),
      ]);

      const [topReturns, highestMultiple, strategyComp] = await Promise.all([
        topReturnsRes.json(),
        highestMultipleRes.json(),
        strategyCompRes.json(),
      ]);

      setTopCallersByReturns(topReturns.data || []);
      setHighestMultipleCalls(highestMultiple.data || []);
      setStrategyComparison(strategyComp.data || []);
      
      if (strategyComp.data && strategyComp.data.length > 0) {
        setSelectedStrategy(strategyComp.data[0].strategyName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance analytics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner text="Loading performance analytics..." className="p-8" />;
  }

  if (error) {
    return <ErrorDisplay message={error} onRetry={loadPerformanceData} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold text-white">Performance Analytics</h2>
        <p className="text-slate-400">Advanced metrics for caller and strategy performance (bots excluded)</p>
        {topCallersByReturns.length === 0 && highestMultipleCalls.length === 0 && (
          <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
            <p className="text-yellow-400 text-sm">
              ⚠️ <strong>Waiting for OHLCV data</strong>: Performance metrics require price candle data from InfluxDB. 
              See <code className="text-yellow-300">INFLUXDB_SETUP_NEEDED.md</code> for setup instructions.
              Core analytics are available in the "Analytics 📊" tab.
            </p>
          </div>
        )}
      </div>

      <Tabs defaultValue="returns" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="returns">Top Returns</TabsTrigger>
          <TabsTrigger value="multiples">Highest Multiples</TabsTrigger>
          <TabsTrigger value="strategies">Strategy Comparison</TabsTrigger>
          <TabsTrigger value="individual">Individual Strategy</TabsTrigger>
        </TabsList>

        {/* Top Callers by Returns */}
        <TabsContent value="returns">
          <div className="grid grid-cols-1 gap-6">
            <Card className="p-6 bg-slate-800 border-slate-700">
              <h3 className="text-xl font-semibold text-white mb-4">Top Callers by Return Multiple</h3>
              <p className="text-sm text-slate-400 mb-4">
                Ranked by average return multiple (bots excluded: Phanes, Rick)
              </p>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={topCallersByReturns} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis type="number" stroke="#94a3b8" />
                  <YAxis dataKey="callerName" type="category" width={150} stroke="#94a3b8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    formatter={(value: any, name: string) => {
                      if (name === 'avgMultiple' || name === 'bestMultiple') {
                        return [`${parseFloat(value).toFixed(2)}x`, name === 'avgMultiple' ? 'Avg Multiple' : 'Best Multiple'];
                      }
                      if (name === 'winRate') {
                        return [`${parseFloat(value).toFixed(1)}%`, 'Win Rate'];
                      }
                      return [value, name];
                    }}
                  />
                  <Legend />
                  <Bar dataKey="avgMultiple" fill="#3b82f6" radius={[0, 8, 8, 0]} name="Avg Multiple" />
                  <Bar dataKey="bestMultiple" fill="#8b5cf6" radius={[0, 8, 8, 0]} name="Best Multiple" />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Win Rate Chart */}
            <Card className="p-6 bg-slate-800 border-slate-700">
              <h3 className="text-xl font-semibold text-white mb-4">Caller Win Rates</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topCallersByReturns}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="callerName" stroke="#94a3b8" angle={-45} textAnchor="end" height={100} />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    formatter={(value: any) => `${parseFloat(value).toFixed(1)}%`}
                  />
                  <Bar dataKey="winRate" fill="#10b981" radius={[8, 8, 0, 0]} name="Win Rate %" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </TabsContent>

        {/* Highest Multiple Calls */}
        <TabsContent value="multiples">
          <Card className="p-6 bg-slate-800 border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-4">Highest Multiple Calls</h3>
            <p className="text-sm text-slate-400 mb-4">
              Top performing calls ranked by return multiple
            </p>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left p-3 text-slate-300">Rank</th>
                    <th className="text-left p-3 text-slate-300">Caller</th>
                    <th className="text-left p-3 text-slate-300">Token</th>
                    <th className="text-right p-3 text-slate-300">Multiple</th>
                    <th className="text-right p-3 text-slate-300">Entry Price</th>
                    <th className="text-right p-3 text-slate-300">Peak Price</th>
                    <th className="text-right p-3 text-slate-300">Time to ATH</th>
                  </tr>
                </thead>
                <tbody>
                  {highestMultipleCalls.map((call, idx) => (
                    <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      <td className="p-3 text-white font-bold">{idx + 1}</td>
                      <td className="p-3 text-white">{call.callerName}</td>
                      <td className="p-3">
                        <div className="text-white font-mono">{call.tokenSymbol}</div>
                        <div className="text-xs text-slate-400 truncate max-w-[200px]">{call.tokenAddress}</div>
                      </td>
                      <td className="p-3 text-right">
                        <span className="text-green-400 font-bold text-lg">
                          {call.multiple.toFixed(2)}x
                        </span>
                      </td>
                      <td className="p-3 text-right text-slate-300">
                        ${call.entryPrice.toExponential(2)}
                      </td>
                      <td className="p-3 text-right text-slate-300">
                        ${call.peakPrice.toExponential(2)}
                      </td>
                      <td className="p-3 text-right text-slate-400">
                        {call.timeToATH || 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Chart visualization */}
            <div className="mt-6">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={highestMultipleCalls.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="tokenSymbol" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    formatter={(value: any) => `${parseFloat(value).toFixed(2)}x`}
                  />
                  <Bar dataKey="multiple" fill="#ec4899" radius={[8, 8, 0, 0]} name="Multiple">
                    {highestMultipleCalls.slice(0, 10).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        {/* Strategy Comparison */}
        <TabsContent value="strategies">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6 bg-slate-800 border-slate-700">
              <h3 className="text-xl font-semibold text-white mb-4">Strategy Performance (PNL)</h3>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={strategyComparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="strategyName" stroke="#94a3b8" angle={-45} textAnchor="end" height={100} />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  />
                  <Bar dataKey="avgPnl" fill="#3b82f6" radius={[8, 8, 0, 0]} name="Avg PNL" />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-6 bg-slate-800 border-slate-700">
              <h3 className="text-xl font-semibold text-white mb-4">Strategy Win Rates</h3>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={strategyComparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="strategyName" stroke="#94a3b8" angle={-45} textAnchor="end" height={100} />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    formatter={(value: any) => `${parseFloat(value).toFixed(1)}%`}
                  />
                  <Bar dataKey="winRate" fill="#10b981" radius={[8, 8, 0, 0]} name="Win Rate %" />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-6 bg-slate-800 border-slate-700 lg:col-span-2">
              <h3 className="text-xl font-semibold text-white mb-4">Most Effective Strategy</h3>
              {strategyComparison.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-slate-700/50 p-4 rounded-lg">
                    <div className="text-sm text-slate-400">Best by PNL</div>
                    <div className="text-xl font-bold text-green-400 mt-1">
                      {strategyComparison.reduce((prev, current) => 
                        (prev.avgPnl > current.avgPnl) ? prev : current
                      ).strategyName}
                    </div>
                    <div className="text-sm text-slate-300 mt-1">
                      Avg PNL: {strategyComparison.reduce((prev, current) => 
                        (prev.avgPnl > current.avgPnl) ? prev : current
                      ).avgPnl.toFixed(4)}
                    </div>
                  </div>

                  <div className="bg-slate-700/50 p-4 rounded-lg">
                    <div className="text-sm text-slate-400">Best Win Rate</div>
                    <div className="text-xl font-bold text-blue-400 mt-1">
                      {strategyComparison.reduce((prev, current) => 
                        (prev.winRate > current.winRate) ? prev : current
                      ).strategyName}
                    </div>
                    <div className="text-sm text-slate-300 mt-1">
                      Win Rate: {strategyComparison.reduce((prev, current) => 
                        (prev.winRate > current.winRate) ? prev : current
                      ).winRate.toFixed(1)}%
                    </div>
                  </div>

                  <div className="bg-slate-700/50 p-4 rounded-lg">
                    <div className="text-sm text-slate-400">Best Sharpe Ratio</div>
                    <div className="text-xl font-bold text-purple-400 mt-1">
                      {strategyComparison.filter(s => s.sharpeRatio).reduce((prev, current) => 
                        ((prev.sharpeRatio || 0) > (current.sharpeRatio || 0)) ? prev : current, 
                        strategyComparison[0]
                      ).strategyName || 'N/A'}
                    </div>
                    <div className="text-sm text-slate-300 mt-1">
                      Sharpe: {strategyComparison.filter(s => s.sharpeRatio).reduce((prev, current) => 
                        ((prev.sharpeRatio || 0) > (current.sharpeRatio || 0)) ? prev : current,
                        strategyComparison[0]
                      ).sharpeRatio?.toFixed(2) || 'N/A'}
                    </div>
                  </div>

                  <div className="bg-slate-700/50 p-4 rounded-lg">
                    <div className="text-sm text-slate-400">Most Tested</div>
                    <div className="text-xl font-bold text-amber-400 mt-1">
                      {strategyComparison.reduce((prev, current) => 
                        (prev.totalRuns > current.totalRuns) ? prev : current
                      ).strategyName}
                    </div>
                    <div className="text-sm text-slate-300 mt-1">
                      Runs: {strategyComparison.reduce((prev, current) => 
                        (prev.totalRuns > current.totalRuns) ? prev : current
                      ).totalRuns}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* Individual Strategy */}
        <TabsContent value="individual">
          <Card className="p-6 bg-slate-800 border-slate-700">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Individual Strategy Analytics</h3>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                className="bg-slate-700 text-white rounded px-4 py-2"
              >
                {strategyComparison.map((strategy) => (
                  <option key={strategy.strategyName} value={strategy.strategyName}>
                    {strategy.strategyName}
                  </option>
                ))}
              </select>
            </div>

            {selectedStrategy && (
              <div className="text-center text-slate-400 py-12">
                <p className="text-lg">Select a strategy above to view detailed analytics</p>
                <p className="text-sm mt-2">Coming soon: Deep dive into {selectedStrategy} performance</p>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

