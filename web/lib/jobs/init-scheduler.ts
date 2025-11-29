// Initialize job scheduler on app startup
import { jobScheduler } from './job-scheduler';

let initialized = false;

export function initJobScheduler() {
  if (initialized) {
    console.log('[JobScheduler] Already initialized');
    return;
  }
  
  // Start scheduler if explicitly enabled or in production
  // In development, user can enable via ENABLE_BACKGROUND_JOBS=true
  const shouldStart = 
    process.env.ENABLE_BACKGROUND_JOBS === 'true' || 
    process.env.NODE_ENV === 'production';
  
  if (shouldStart) {
    try {
      jobScheduler.start();
      initialized = true;
      console.log('[JobScheduler] ✅ Background jobs started');
      console.log('[JobScheduler] - Strategy computation: every 6 hours');
      console.log('[JobScheduler] - Dashboard computation: every 1 hour');
    } catch (error) {
      console.error('[JobScheduler] ❌ Failed to start:', error);
    }
  } else {
    console.log('[JobScheduler] ⚠️  Background jobs disabled');
    console.log('[JobScheduler] Set ENABLE_BACKGROUND_JOBS=true to enable');
  }
}

// Auto-initialize if this is a server-side context
// This will run when the module is imported
if (typeof window === 'undefined') {
  // Use setImmediate to ensure it runs after module loading
  setImmediate(() => {
    initJobScheduler();
  });
}

