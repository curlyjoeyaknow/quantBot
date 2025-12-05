'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemeToggle } from '@/components/ui/theme-toggle';

// Lazy load components for code splitting
const Dashboard = dynamic(() => import('@/components/dashboard').then(mod => ({ default: mod.Dashboard })), {
  loading: () => <div className="p-8 text-center text-white">Loading dashboard...</div>,
});

const CallerHistory = dynamic(() => import('@/components/caller-history').then(mod => ({ default: mod.CallerHistory })), {
  loading: () => <div className="p-8 text-center text-white">Loading caller history...</div>,
});

const RecentAlerts = dynamic(() => import('@/components/recent-alerts').then(mod => ({ default: mod.RecentAlerts })), {
  loading: () => <div className="p-8 text-center text-white">Loading recent alerts...</div>,
});

const Simulations = dynamic(() => import('@/components/simulations').then(mod => ({ default: mod.Simulations })), {
  loading: () => <div className="p-8 text-center text-white">Loading simulations...</div>,
});

const Optimizations = dynamic(() => import('@/components/optimizations').then(mod => ({ default: mod.Optimizations })), {
  loading: () => <div className="p-8 text-center text-white">Loading optimizations...</div>,
});

const Callers = dynamic(() => import('@/components/callers').then(mod => ({ default: mod.Callers })), {
  loading: () => <div className="p-8 text-center text-white">Loading callers...</div>,
});

const Recording = dynamic(() => import('@/components/recording').then(mod => ({ default: mod.Recording })), {
  loading: () => <div className="p-8 text-center text-white">Loading recording status...</div>,
});

const Health = dynamic(() => import('@/components/health').then(mod => ({ default: mod.Health })), {
  loading: () => <div className="p-8 text-center text-white">Loading health status...</div>,
});

const ControlPanel = dynamic(() => import('@/components/control-panel').then(mod => ({ default: mod.ControlPanel })), {
  loading: () => <div className="p-8 text-center text-white">Loading control panel...</div>,
});

const WeeklyReports = dynamic(() => import('@/components/weekly-reports').then(mod => ({ default: mod.WeeklyReports })), {
  loading: () => <div className="p-8 text-center text-white">Loading weekly reports...</div>,
});

const LiveTradeStrategies = dynamic(() => import('@/components/live-trade-strategies').then(mod => ({ default: mod.LiveTradeStrategies })), {
  loading: () => <div className="p-8 text-center text-white">Loading strategies...</div>,
});

const SignIn = dynamic(() => import('@/components/sign-in'), {
  loading: () => <div className="p-8 text-center text-white">Loading...</div>,
});

const SetupOverview = dynamic(() => import('@/components/setup-overview'), {
  loading: () => <div className="p-8 text-center text-white">Loading...</div>,
});

const AddProduct = dynamic(() => import('@/components/add-product'), {
  loading: () => <div className="p-8 text-center text-white">Loading...</div>,
});

const ShippingPricing = dynamic(() => import('@/components/shipping-pricing'), {
  loading: () => <div className="p-8 text-center text-white">Loading...</div>,
});

const RegisterAccount = dynamic(() => import('@/components/register-account'), {
  loading: () => <div className="p-8 text-center text-white">Loading...</div>,
});

const ForgotPassword = dynamic(() => import('@/components/forgot-password'), {
  loading: () => <div className="p-8 text-center text-white">Loading...</div>,
});

const ReviewSummary = dynamic(() => import('@/components/review-summary'), {
  loading: () => <div className="p-8 text-center text-white">Loading...</div>,
});

import { ShopifyFlowProvider } from '@/components/shopify-flow-context';

const FigmaDashboard = dynamic(() => import('@/components/figma-dashboard').then(mod => ({ default: mod.FigmaDashboard })), {
  loading: () => <div className="p-8 text-center text-white">Loading Figma dashboard...</div>,
});

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto p-6">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">QuantBot Dashboard</h1>
            <p className="text-slate-400">Unified interface for trading analytics and performance tracking</p>
          </div>
          <div className="mt-2">
            <ThemeToggle />
          </div>
        </header>

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="grid w-full grid-cols-12 mb-6">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="caller-history">Caller History</TabsTrigger>
            <TabsTrigger value="recent-alerts">Recent Alerts</TabsTrigger>
            <TabsTrigger value="callers">Callers</TabsTrigger>
            <TabsTrigger value="simulations">Simulations</TabsTrigger>
            <TabsTrigger value="optimizations">Optimizations</TabsTrigger>
            <TabsTrigger value="recording">Recording</TabsTrigger>
            <TabsTrigger value="health">Health</TabsTrigger>
            <TabsTrigger value="live-trade">Live Trade</TabsTrigger>
            <TabsTrigger value="weekly-reports">Reports</TabsTrigger>
            <TabsTrigger value="control-panel">Control</TabsTrigger>
            <TabsTrigger value="figma">Figma 🎨</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <Dashboard />
          </TabsContent>

          <TabsContent value="caller-history">
            <CallerHistory />
          </TabsContent>

          <TabsContent value="recent-alerts">
            <RecentAlerts />
          </TabsContent>

          <TabsContent value="simulations">
            <Simulations />
          </TabsContent>

          <TabsContent value="callers">
            <Callers />
          </TabsContent>

          <TabsContent value="optimizations">
            <Optimizations />
          </TabsContent>

          <TabsContent value="recording">
            <Recording />
          </TabsContent>

          <TabsContent value="health">
            <Health />
          </TabsContent>

          <TabsContent value="live-trade">
            <LiveTradeStrategies />
          </TabsContent>

          <TabsContent value="weekly-reports">
            <WeeklyReports />
          </TabsContent>

          <TabsContent value="control-panel">
            <ControlPanel />
          </TabsContent>

          <TabsContent value="figma">
            <ShopifyFlowProvider>
              <div className="space-y-6">
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                  <h2 className="text-2xl font-bold text-white mb-4">📱 Figma Design Replicas</h2>
                  <p className="text-slate-400 mb-4">Interactive replicas of Figma designs with all inputs and navigation working</p>
                  
                  <Tabs defaultValue="sign-in" className="w-full">
                  <TabsList className="grid w-full grid-cols-7 mb-6">
                    <TabsTrigger value="sign-in">Sign In</TabsTrigger>
                    <TabsTrigger value="register">Register</TabsTrigger>
                    <TabsTrigger value="forgot">Forgot</TabsTrigger>
                    <TabsTrigger value="setup">Setup</TabsTrigger>
                    <TabsTrigger value="add-product">Product</TabsTrigger>
                    <TabsTrigger value="shipping">Shipping</TabsTrigger>
                    <TabsTrigger value="review">Review</TabsTrigger>
                  </TabsList>

                  <TabsContent value="sign-in">
                    <div className="flex justify-center">
                      <div className="relative bg-white shadow-2xl rounded-lg overflow-hidden" style={{ width: '440px', height: '956px' }}>
                        <div className="absolute inset-0 overflow-auto">
                          <SignIn />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="register">
                    <div className="flex justify-center">
                      <div className="relative bg-white shadow-2xl rounded-lg overflow-hidden" style={{ width: '440px', height: '956px' }}>
                        <div className="absolute inset-0 overflow-auto">
                          <RegisterAccount />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="forgot">
                    <div className="flex justify-center">
                      <div className="relative bg-white shadow-2xl rounded-lg overflow-hidden" style={{ width: '440px', height: '956px' }}>
                        <div className="absolute inset-0 overflow-auto">
                          <ForgotPassword />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="setup">
                    <div className="flex justify-center">
                      <div className="relative bg-white shadow-2xl rounded-lg overflow-hidden" style={{ width: '440px', height: '956px' }}>
                        <div className="absolute inset-0 overflow-auto">
                          <SetupOverview />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="add-product">
                    <div className="flex justify-center">
                      <div className="relative bg-white shadow-2xl rounded-lg overflow-hidden" style={{ width: '440px', height: '956px' }}>
                        <div className="absolute inset-0 overflow-auto">
                          <AddProduct />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="shipping">
                    <div className="flex justify-center">
                      <div className="relative bg-white shadow-2xl rounded-lg overflow-hidden" style={{ width: '440px', height: '956px' }}>
                        <div className="absolute inset-0 overflow-auto">
                          <ShippingPricing />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="review">
                    <div className="flex justify-center">
                      <div className="relative bg-white shadow-2xl rounded-lg overflow-hidden" style={{ width: '440px', height: '956px' }}>
                        <div className="absolute inset-0 overflow-auto">
                          <ReviewSummary />
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
            </ShopifyFlowProvider>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

