'use client';

import Link from 'next/link';

export default function FigmaReplicasIndex() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-4">Figma Design Replicas</h1>
        <p className="text-slate-400 mb-8">Exact replicas of Figma designs with interaction fixes</p>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {/* Sign In Card */}
          <Link 
            href="/figma-replicas/sign-in"
            className="block p-6 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <h2 className="text-2xl font-bold text-white mb-2">Sign In Page</h2>
            <p className="text-slate-400 mb-4">
              Login form with email and password inputs
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Visible borders</span>
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Mobile view</span>
            </div>
          </Link>

          {/* Register Card */}
          <Link 
            href="/figma-replicas/register"
            className="block p-6 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <h2 className="text-2xl font-bold text-white mb-2">Register Page</h2>
            <p className="text-slate-400 mb-4">
              New account registration with popup
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Success popup</span>
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Validation</span>
            </div>
          </Link>

          {/* Forgot Password Card */}
          <Link 
            href="/figma-replicas/forgot-password"
            className="block p-6 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <h2 className="text-2xl font-bold text-white mb-2">Forgot Password</h2>
            <p className="text-slate-400 mb-4">
              Password recovery via email
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Email sent popup</span>
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Waiting state</span>
            </div>
          </Link>

          {/* Add Product Card */}
          <Link 
            href="/figma-replicas/add-product"
            className="block p-6 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <h2 className="text-2xl font-bold text-white mb-2">Add Product Page</h2>
            <p className="text-slate-400 mb-4">
              Product upload interface with progress tracking
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Dropdown clickable</span>
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Mobile view forced</span>
            </div>
          </Link>

          {/* Setup Overview Card */}
          <Link 
            href="/figma-replicas/setup-overview"
            className="block p-6 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <h2 className="text-2xl font-bold text-white mb-2">Setup Overview Page</h2>
            <p className="text-slate-400 mb-4">
              Shop name setup with next steps
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Input field clickable</span>
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Mobile view forced</span>
            </div>
          </Link>

          {/* Shipping & Pricing Card */}
          <Link 
            href="/figma-replicas/shipping-pricing"
            className="block p-6 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <h2 className="text-2xl font-bold text-white mb-2">Shipping & Pricing</h2>
            <p className="text-slate-400 mb-4">
              Configure pricing and shipping options
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ All inputs working</span>
              <span className="px-2 py-1 bg-green-900 text-green-200 rounded text-sm">✓ Mobile view forced</span>
            </div>
          </Link>
        </div>

        <div className="mt-8 p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
          <h3 className="text-lg font-semibold text-blue-200 mb-2">ℹ️ What was fixed:</h3>
          <ul className="text-blue-300 space-y-1 list-disc list-inside">
            <li>Input fields changed from divs to proper input elements</li>
            <li>Z-index layering fixed for overlapping elements</li>
            <li>Pointer events configured to prevent click conflicts</li>
            <li>Focus states added for better UX</li>
            <li>Proper semantic HTML for accessibility</li>
            <li>Mobile viewport forced (440px × 956px) - designs are mobile-first</li>
          </ul>
        </div>

        <div className="mt-4">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

