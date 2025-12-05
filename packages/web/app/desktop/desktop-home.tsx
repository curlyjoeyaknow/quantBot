'use client';

/**
 * Desktop Home View
 * =================
 * Desktop-optimized home view with:
 * - Overview cards
 * - Quick actions
 * - Recent activity
 * - Statistics
 */

import { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Settings, 
  FileText, 
  TrendingUp,
  Clock,
  Activity,
  Zap
} from 'lucide-react';

interface DesktopHomeViewProps {
  user: { id: number; name: string; email?: string } | null;
  onNavigate: (view: 'backtest' | 'results' | 'strategies') => void;
}

export function DesktopHomeView({ user, onNavigate }: DesktopHomeViewProps) {
  const [stats, setStats] = useState({
    totalBacktests: 0,
    activeStrategies: 0,
    totalProfit: 0,
    winRate: 0,
  });

  useEffect(() => {
    // Load stats
    const loadStats = async () => {
      try {
        // TODO: Replace with actual API calls
        setStats({
          totalBacktests: 24,
          activeStrategies: 8,
          totalProfit: 12.5,
          winRate: 68.5,
        });
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    };

    loadStats();
  }, []);

  const quickActions = [
    {
      id: 'backtest',
      label: 'New Backtest',
      description: 'Configure and run a new simulation',
      icon: BarChart3,
      color: 'indigo',
      onClick: () => onNavigate('backtest'),
    },
    {
      id: 'results',
      label: 'View Results',
      description: 'Browse simulation results and analytics',
      icon: FileText,
      color: 'emerald',
      onClick: () => onNavigate('results'),
    },
    {
      id: 'strategies',
      label: 'Manage Strategies',
      description: 'Configure trading strategies',
      icon: Settings,
      color: 'blue',
      onClick: () => onNavigate('strategies'),
    },
  ];

  const statCards = [
    {
      label: 'Total Backtests',
      value: stats.totalBacktests,
      icon: BarChart3,
      color: 'indigo',
      trend: '+12%',
    },
    {
      label: 'Active Strategies',
      value: stats.activeStrategies,
      icon: Zap,
      color: 'emerald',
      trend: '+3',
    },
    {
      label: 'Total Profit %',
      value: `${stats.totalProfit}%`,
      icon: TrendingUp,
      color: 'emerald',
      trend: '+2.3%',
    },
    {
      label: 'Win Rate',
      value: `${stats.winRate}%`,
      icon: Activity,
      color: 'blue',
      trend: '+5.2%',
    },
  ];

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Welcome Section */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">
          Welcome back{user ? `, ${user.name}` : ''}!
        </h1>
        <p className="text-slate-400">
          Manage your trading strategies, run backtests, and analyze results.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card) => {
          const Icon = card.icon;
          const colorClasses = {
            indigo: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400',
            emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
            blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
          };

          return (
            <div
              key={card.label}
              className="bg-slate-800 border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-lg ${colorClasses[card.color as keyof typeof colorClasses]}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-medium text-emerald-400">{card.trend}</span>
              </div>
              <div className="text-sm text-slate-400 mb-1">{card.label}</div>
              <div className="text-2xl font-bold text-white">{card.value}</div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {quickActions.map((action) => {
            const Icon = action.icon;
            const colorClasses = {
              indigo: 'bg-indigo-600 hover:bg-indigo-700 border-indigo-500',
              emerald: 'bg-emerald-600 hover:bg-emerald-700 border-emerald-500',
              blue: 'bg-blue-600 hover:bg-blue-700 border-blue-500',
            };

            return (
              <button
                key={action.id}
                onClick={action.onClick}
                className={`${colorClasses[action.color as keyof typeof colorClasses]} border rounded-xl p-6 text-left transition-all hover:scale-[1.02] group`}
              >
                <div className="flex items-center gap-4 mb-3">
                  <div className="p-3 bg-white/10 rounded-lg group-hover:bg-white/20 transition-colors">
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">{action.label}</h3>
                </div>
                <p className="text-sm text-white/80">{action.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Backtests */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Recent Backtests</h3>
            <button
              onClick={() => onNavigate('results')}
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              View all →
            </button>
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg hover:bg-slate-900 transition-colors cursor-pointer"
              >
                <div>
                  <div className="text-sm font-medium text-white">SOL/USDC Backtest</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    <Clock className="h-3 w-3 inline mr-1" />
                    2 hours ago
                  </div>
                </div>
                <div className="text-sm font-semibold text-emerald-400">+12.5%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Active Strategies */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Active Strategies</h3>
            <button
              onClick={() => onNavigate('strategies')}
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              Manage →
            </button>
          </div>
          <div className="space-y-3">
            {['Tenkan-Kijun Cross', 'RSI Oversold', 'MACD Crossover'].map((strategy, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 bg-emerald-400 rounded-full"></div>
                  <span className="text-sm text-white">{strategy}</span>
                </div>
                <span className="text-xs text-slate-400">Active</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

