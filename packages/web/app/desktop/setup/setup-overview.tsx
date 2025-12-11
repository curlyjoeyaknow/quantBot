'use client';

/**
 * Desktop Setup Overview Component
 * ==================================
 * First step of the setup wizard with:
 * - Progress indicator
 * - Shop name configuration
 * - Multi-step navigation
 */

import { useState } from 'react';
import { ArrowRight, ArrowLeft, Store } from 'lucide-react';

interface DesktopSetupOverviewProps {
  onContinue?: (shopName: string) => void;
  onBack?: () => void;
  initialShopName?: string;
}

export function DesktopSetupOverview({ 
  onContinue, 
  onBack, 
  initialShopName = '' 
}: DesktopSetupOverviewProps) {
  const [shopName, setShopName] = useState(initialShopName);

  const handleContinue = () => {
    if (shopName.trim() && onContinue) {
      onContinue(shopName);
    }
  };

  return (
    <div className="flex h-screen bg-slate-900">
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Progress Header */}
        <div className="bg-slate-800 border-b border-slate-700 p-6">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-2xl font-bold text-white">Setup Your Shop</h1>
              <span className="text-sm text-slate-400">Step 1 of 4</span>
            </div>
            
            {/* Progress Bar */}
            <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-indigo-600 rounded-full transition-all duration-300" style={{ width: '25%' }}></div>
            </div>
            
            {/* Step Labels */}
            <div className="flex justify-between mt-3 text-xs">
              <span className="text-indigo-400 font-medium">Overview</span>
              <span className="text-slate-500">Products</span>
              <span className="text-slate-500">Shipping</span>
              <span className="text-slate-500">Review</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-2xl w-full">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-12">
              {/* Icon */}
              <div className="mb-8 flex justify-center">
                <div className="h-20 w-20 bg-indigo-600/20 border-2 border-indigo-600 rounded-2xl flex items-center justify-center">
                  <Store className="h-10 w-10 text-indigo-400" />
                </div>
              </div>

              {/* Title */}
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-white mb-3">
                  Almost done! What should we call your shop?
                </h2>
                <p className="text-slate-400">
                  Choose a memorable name that represents your brand
                </p>
              </div>

              {/* Shop Name Input */}
              <div className="mb-8">
                <label htmlFor="shopName" className="block text-sm font-medium text-slate-300 mb-3">
                  Shop Name
                </label>
                <input
                  id="shopName"
                  type="text"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="Enter your shop name"
                  className="w-full px-6 py-4 bg-slate-900 border-2 border-slate-700 rounded-xl text-white text-lg placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  autoFocus
                />
                {shopName && (
                  <p className="mt-2 text-sm text-slate-400">
                    Your shop will be accessible at: <span className="text-indigo-400 font-medium">{shopName.toLowerCase().replace(/\s+/g, '-')}.quantbot.com</span>
                  </p>
                )}
              </div>

              {/* Next Steps Preview */}
              <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-6 mb-8">
                <h3 className="text-lg font-semibold text-white mb-4">Next steps:</h3>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3 text-slate-300">
                    <div className="h-6 w-6 bg-indigo-600/20 border border-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-xs text-indigo-400 font-medium">2</span>
                    </div>
                    Add your products
                  </li>
                  <li className="flex items-center gap-3 text-slate-300">
                    <div className="h-6 w-6 bg-slate-700 border border-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-xs text-slate-400 font-medium">3</span>
                    </div>
                    Configure pricing and shipping
                  </li>
                  <li className="flex items-center gap-3 text-slate-300">
                    <div className="h-6 w-6 bg-slate-700 border border-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-xs text-slate-400 font-medium">4</span>
                    </div>
                    Review and launch
                  </li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                {onBack && (
                  <button
                    onClick={onBack}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl transition-all"
                  >
                    <ArrowLeft className="h-5 w-5" />
                    Back
                  </button>
                )}
                <button
                  onClick={handleContinue}
                  disabled={!shopName.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all transform hover:scale-[1.02] disabled:transform-none"
                >
                  Continue
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

