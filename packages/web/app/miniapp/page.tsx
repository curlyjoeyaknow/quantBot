'use client';

/**
 * Telegram Mini App - Main Entry Point
 * =====================================
 * This page serves as the main entry point for the Telegram Mini App.
 * It handles authentication, routing, and initial data loading.
 */

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BacktestConfig } from './backtest-config';
import { SimulationResults } from './simulation-results';
import { StrategyManager } from './strategy-manager';

// Telegram Web App SDK types
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    chat?: {
      id: number;
      type: string;
    };
    auth_date: number;
    hash: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
  };
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  BackButton: {
    isVisible: boolean;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
    show: () => void;
    hide: () => void;
  };
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    isProgressVisible: boolean;
    setText: (text: string) => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    setParams: (params: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
  sendData: (data: string) => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  openInvoice: (url: string, callback?: (status: string) => void) => void;
  showPopup: (params: { title?: string; message: string; buttons?: Array<{ id?: string; type?: string; text: string }> }, callback?: (id: string) => void) => void;
  showAlert: (message: string, callback?: () => void) => void;
  showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void;
  showScanQrPopup: (params: { text?: string }, callback?: (data: string) => void) => void;
  closeScanQrPopup: () => void;
  readTextFromClipboard: (callback?: (text: string) => void) => void;
  requestWriteAccess: (callback?: (granted: boolean) => void) => void;
  requestContact: (callback?: (granted: boolean) => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

type MiniAppView = 'home' | 'backtest' | 'results' | 'strategies';

function MiniAppContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<MiniAppView>('home');
  const [telegram, setTelegram] = useState<TelegramWebApp | null>(null);
  const [user, setUser] = useState<{ id: number; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize Telegram Web App
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      setTelegram(tg);

      // Extract user info
      if (tg.initDataUnsafe.user) {
        const u = tg.initDataUnsafe.user;
        setUser({
          id: u.id,
          name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username || 'User',
        });
      }

      // Set theme
      document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#ffffff');
      document.documentElement.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#000000');
      document.documentElement.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color || '#999999');
      document.documentElement.style.setProperty('--tg-theme-link-color', tg.themeParams.link_color || '#2481cc');
      document.documentElement.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color || '#2481cc');
      document.documentElement.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color || '#ffffff');

      setLoading(false);
    } else {
      // Not in Telegram - show error or fallback
      console.warn('Telegram Web App not available');
      setLoading(false);
    }

    // Check for view parameter
    const viewParam = searchParams.get('view');
    if (viewParam && ['home', 'backtest', 'results', 'strategies'].includes(viewParam)) {
      setView(viewParam as MiniAppView);
    }
  }, [searchParams]);

  const handleBack = () => {
    if (view !== 'home') {
      setView('home');
    } else if (telegram) {
      telegram.close();
    }
  };

  const handleSendData = (data: Record<string, any>) => {
    if (telegram) {
      telegram.sendData(JSON.stringify(data));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--tg-theme-bg-color)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--tg-theme-button-color)] mx-auto mb-4"></div>
          <p className="text-[var(--tg-theme-text-color)]">Loading...</p>
        </div>
      </div>
    );
  }

  if (!telegram) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--tg-theme-bg-color)]">
        <div className="text-center p-6">
          <p className="text-[var(--tg-theme-text-color)] mb-4">
            This app must be opened from Telegram.
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="px-4 py-2 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg"
          >
            Go to Web Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Setup back button
  useEffect(() => {
    if (!telegram) return;

    if (view !== 'home') {
      telegram.BackButton.show();
      telegram.BackButton.onClick(handleBack);
    } else {
      telegram.BackButton.hide();
    }

    return () => {
      telegram.BackButton.offClick(handleBack);
    };
  }, [view, telegram]);

  return (
    <div className="min-h-screen bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      {view === 'home' && (
        <HomeView
          user={user}
          onNavigate={(newView) => setView(newView)}
          telegram={telegram}
        />
      )}
      {view === 'backtest' && (
        <BacktestConfig
          user={user}
          telegram={telegram}
          onComplete={(result) => {
            handleSendData({ type: 'simulation_complete', result });
            setView('results');
          }}
          onBack={() => setView('home')}
        />
      )}
      {view === 'results' && (
        <SimulationResults
          user={user}
          telegram={telegram}
          onBack={() => setView('home')}
        />
      )}
      {view === 'strategies' && (
        <StrategyManager
          user={user}
          telegram={telegram}
          onBack={() => setView('home')}
        />
      )}
    </div>
  );
}

function HomeView({
  user,
  onNavigate,
  telegram,
}: {
  user: { id: number; name: string } | null;
  onNavigate: (view: MiniAppView) => void;
  telegram: TelegramWebApp;
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold mb-2">🤖 QuantBot</h1>
        {user && <p className="text-[var(--tg-theme-hint-color)]">Welcome, {user.name}!</p>}
      </div>

      <div className="space-y-3">
        <button
          onClick={() => {
            telegram.HapticFeedback.impactOccurred('light');
            onNavigate('backtest');
          }}
          className="w-full p-4 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg font-semibold text-left flex items-center justify-between"
        >
          <span>📊 New Backtest</span>
          <span>→</span>
        </button>

        <button
          onClick={() => {
            telegram.HapticFeedback.impactOccurred('light');
            onNavigate('results');
          }}
          className="w-full p-4 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg font-semibold text-left flex items-center justify-between"
        >
          <span>📈 View Results</span>
          <span>→</span>
        </button>

        <button
          onClick={() => {
            telegram.HapticFeedback.impactOccurred('light');
            onNavigate('strategies');
          }}
          className="w-full p-4 bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)] rounded-lg font-semibold text-left flex items-center justify-between"
        >
          <span>⚙️ Manage Strategies</span>
          <span>→</span>
        </button>
      </div>

      <div className="mt-8 p-4 bg-[var(--tg-theme-hint-color)] bg-opacity-10 rounded-lg">
        <p className="text-sm text-[var(--tg-theme-hint-color)] text-center">
          Select an option above to get started
        </p>
      </div>
    </div>
  );
}

export default function MiniAppPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[var(--tg-theme-bg-color)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--tg-theme-button-color)] mx-auto mb-4"></div>
          <p className="text-[var(--tg-theme-text-color)]">Loading...</p>
        </div>
      </div>
    }>
      <MiniAppContent />
    </Suspense>
  );
}

