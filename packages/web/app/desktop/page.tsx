'use client';

/**
 * QuantBot Desktop App - Main Entry Point
 * =======================================
 * Desktop-optimized version of the mobile app with:
 * - Sidebar navigation
 * - Multi-column layouts
 * - Enhanced data visualization
 * - Keyboard shortcuts
 * - Better information density
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DesktopHomeView } from './desktop-home';
import { DesktopBacktestConfig } from './desktop-backtest-config';
import { DesktopSimulationResults } from './desktop-simulation-results';
import { DesktopStrategyManager } from './desktop-strategy-manager';
import { 
  LayoutDashboard, 
  BarChart3, 
  Settings, 
  FileText,
  Menu,
  X,
  Keyboard
} from 'lucide-react';

type DesktopView = 'home' | 'backtest' | 'results' | 'strategies';

interface User {
  id: number;
  name: string;
  email?: string;
}

export default function DesktopAppPage() {
  const router = useRouter();
  const [view, setView] = useState<DesktopView>('home');
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load user data (mock for now, replace with actual auth)
    const loadUser = async () => {
      try {
        // TODO: Replace with actual auth check
        setUser({
          id: 1,
          name: 'User',
          email: 'user@example.com',
        });
      } catch (error) {
        console.error('Failed to load user:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K for command palette (future)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        // TODO: Open command palette
      }

      // Escape to go back
      if (e.key === 'Escape' && view !== 'home') {
        setView('home');
      }

      // Number keys for navigation
      if (e.key === '1' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setView('home');
      }
      if (e.key === '2' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setView('backtest');
      }
      if (e.key === '3' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setView('results');
      }
      if (e.key === '4' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setView('strategies');
      }

      // Toggle sidebar with Cmd/Ctrl + B
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [view]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading desktop app...</p>
        </div>
      </div>
    );
  }

  const navigationItems = [
    { id: 'home', label: 'Dashboard', icon: LayoutDashboard, shortcut: '⌘1' },
    { id: 'backtest', label: 'New Backtest', icon: BarChart3, shortcut: '⌘2' },
    { id: 'results', label: 'Results', icon: FileText, shortcut: '⌘3' },
    { id: 'strategies', label: 'Strategies', icon: Settings, shortcut: '⌘4' },
  ] as const;

  return (
    <div className="flex h-screen bg-slate-900 text-white overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-0'
        } bg-slate-800 border-r border-slate-700 transition-all duration-300 overflow-hidden flex flex-col`}
      >
        {/* Sidebar Header */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-white">🤖 QuantBot</h1>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>
          {user && (
            <div className="text-sm text-slate-400">
              <div className="font-medium text-slate-300">{user.name}</div>
              {user.email && <div className="text-xs mt-0.5">{user.email}</div>}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id as DesktopView)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                </div>
                <span className="text-xs text-slate-400">{item.shortcut}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Keyboard className="h-4 w-4" />
            <span>Keyboard shortcuts</span>
          </div>
        </div>
      </aside>

      {/* Sidebar Toggle (when closed) */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-4 top-4 z-50 p-2 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
        >
          <Menu className="h-5 w-5 text-slate-400" />
        </button>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-white">
              {navigationItems.find((item) => item.id === view)?.label || 'Dashboard'}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            {/* Status indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <div className="h-2 w-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs font-medium text-emerald-400">Live</span>
            </div>
            {/* Settings button */}
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              Web Dashboard
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-900">
          {view === 'home' && (
            <DesktopHomeView
              user={user}
              onNavigate={(newView) => setView(newView)}
            />
          )}
          {view === 'backtest' && (
            <DesktopBacktestConfig
              user={user}
              onComplete={(result) => {
                console.log('Backtest complete:', result);
                setView('results');
              }}
              onBack={() => setView('home')}
            />
          )}
          {view === 'results' && (
            <DesktopSimulationResults
              user={user}
              onBack={() => setView('home')}
            />
          )}
          {view === 'strategies' && (
            <DesktopStrategyManager
              user={user}
              onBack={() => setView('home')}
            />
          )}
        </div>
      </main>
    </div>
  );
}

