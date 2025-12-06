'use client';

/**
 * Desktop Sign In Component
 * ==========================
 * Desktop-optimized sign-in page with:
 * - Split-screen layout (left: branding, right: form)
 * - Larger form fields and buttons
 * - Better visual hierarchy
 * - Enhanced animations
 */

import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, ArrowRight, Github, Chrome } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface DesktopSignInProps {
  onSignIn?: (email: string, password: string) => Promise<void>;
  onNavigateRegister?: () => void;
  onNavigateForgotPassword?: () => void;
}

export function DesktopSignIn({ 
  onSignIn, 
  onNavigateRegister, 
  onNavigateForgotPassword 
}: DesktopSignInProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (onSignIn) {
        await onSignIn(email, password);
      } else {
        // Default navigation
        router.push('/desktop');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-900">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 p-12 flex-col justify-between relative overflow-hidden">
        {/* Animated background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 -left-4 w-96 h-96 bg-white rounded-full mix-blend-multiply filter blur-xl animate-blob"></div>
          <div className="absolute top-0 -right-4 w-96 h-96 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-2000"></div>
          <div className="absolute -bottom-8 left-20 w-96 h-96 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-4000"></div>
        </div>

        {/* Content */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-12 w-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
              <span className="text-2xl">🤖</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">QuantBot</h1>
              <p className="text-sm text-white/80">Trading Intelligence</p>
            </div>
          </div>

          <div className="space-y-6 mt-16">
            <h2 className="text-4xl font-bold text-white leading-tight">
              Trade Smarter,<br />Not Harder
            </h2>
            <p className="text-lg text-white/90 max-w-md">
              Advanced backtesting, real-time monitoring, and intelligent trading strategies
              powered by AI.
            </p>
            
            <div className="space-y-4 pt-8">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
                  <span className="text-white">✓</span>
                </div>
                <span className="text-white/90">Real-time market monitoring</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
                  <span className="text-white">✓</span>
                </div>
                <span className="text-white/90">Advanced backtesting engine</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
                  <span className="text-white">✓</span>
                </div>
                <span className="text-white/90">AI-powered strategy optimization</span>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-white/60 text-sm">
          © 2025 QuantBot. Built for traders, by traders.
        </div>
      </div>

      {/* Right Panel - Sign In Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-900">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-white mb-2">Welcome back</h2>
            <p className="text-slate-400">Sign in to your QuantBot account</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Social Sign In */}
          <div className="space-y-3 mb-8">
            <button
              type="button"
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors text-white font-medium"
            >
              <Chrome className="h-5 w-5" />
              Continue with Google
            </button>
            <button
              type="button"
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors text-white font-medium"
            >
              <Github className="h-5 w-5" />
              Continue with GitHub
            </button>
          </div>

          {/* Divider */}
          <div className="relative mb-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-slate-900 text-slate-400">Or continue with email</span>
            </div>
          </div>

          {/* Sign In Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email Input */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full pl-11 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full pl-11 pr-12 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Remember & Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900"
                />
                <span className="ml-2 text-sm text-slate-400">Remember me</span>
              </label>
              <button
                type="button"
                onClick={onNavigateForgotPassword}
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Forgot password?
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all transform hover:scale-[1.02] disabled:transform-none"
            >
              {isLoading ? (
                <>
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>

          {/* Sign Up Link */}
          <p className="mt-8 text-center text-sm text-slate-400">
            Don't have an account?{' '}
            <button
              onClick={onNavigateRegister}
              className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              Sign up for free
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

