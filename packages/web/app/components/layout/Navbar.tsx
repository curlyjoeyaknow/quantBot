'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Navbar() {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === '/') {
      return pathname === '/';
    }
    return pathname?.startsWith(path);
  };

  const navLinkClass = (path: string) => {
    const base = 'text-sm font-medium transition-colors';
    return isActive(path)
      ? `${base} text-foreground border-b-2 border-primary`
      : `${base} text-muted-foreground hover:text-foreground`;
  };

  return (
    <nav className="border-b bg-background sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link href="/" className="text-xl font-bold">
              QuantBot
            </Link>
            <div className="flex space-x-6">
              <Link href="/" className={navLinkClass('/')}>
                Dashboard
              </Link>
              <Link href="/callers" className={navLinkClass('/callers')}>
                Callers
              </Link>
              <Link href="/simulations" className={navLinkClass('/simulations')}>
                Simulations
              </Link>
              <Link href="/analytics" className={navLinkClass('/analytics')}>
                Analytics
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/simulations/compare"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Compare
            </Link>
            <Link
              href="/api/health"
              target="_blank"
              className="text-xs text-muted-foreground hover:text-foreground"
              title="Health Check"
            >
              Health
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

