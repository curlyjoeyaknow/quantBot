'use client';

/**
 * Desktop Forgot Password Component
 * ==================================
 * Password reset flow with email verification
 */

import { useState } from 'react';
import { Mail, ArrowLeft, Check } from 'lucide-react';

interface DesktopForgotPasswordProps {
  onSubmit?: (email: string) => Promise<void>;
  onNavigateSignIn?: () => void;
}

export function DesktopForgotPassword({ onSubmit, onNavigateSignIn }: DesktopForgotPasswordProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (onSubmit) {
        await onSubmit(email);
      }
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-900">
      {/* Left Panel - Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Back Button */}
          <button
            onClick={onNavigateSignIn}
            className="flex items-center gap-2 text-slate-400 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </button>

          {!isSuccess ? (
            <>
              {/* Header */}
              <div className="mb-8">
                <h2 className="text-3xl font-bold text-white mb-2">Forgot password?</h2>
                <p className="text-slate-400">
                  No worries, we'll send you reset instructions.
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              {/* Reset Form */}
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

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all transform hover:scale-[1.02] disabled:transform-none"
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Sending...
                    </div>
                  ) : (
                    'Send reset link'
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Success State */}
              <div className="text-center">
                <div className="mx-auto h-16 w-16 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mb-6">
                  <Check className="h-8 w-8 text-emerald-500" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Check your email</h2>
                <p className="text-slate-400 mb-8">
                  We sent a password reset link to <span className="text-white font-medium">{email}</span>
                </p>
                <div className="space-y-4">
                  <button
                    onClick={onNavigateSignIn}
                    className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition-all"
                  >
                    Back to sign in
                  </button>
                  <p className="text-sm text-slate-500">
                    Didn't receive the email?{' '}
                    <button
                      onClick={() => setIsSuccess(false)}
                      className="text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      Click to resend
                    </button>
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right Panel - Illustration */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-indigo-600/20 to-purple-600/20 p-12 items-center justify-center relative overflow-hidden">
        <div className="relative z-10 max-w-md text-center">
          <div className="text-8xl mb-6">🔐</div>
          <h3 className="text-2xl font-bold text-white mb-4">Secure Password Reset</h3>
          <p className="text-slate-300">
            We take security seriously. The reset link will expire in 1 hour for your protection.
          </p>
        </div>
      </div>
    </div>
  );
}

