import Link from 'next/link';

export function Navbar() {
  return (
    <nav className="border-b bg-background">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link href="/" className="text-xl font-bold">
              QuantBot
            </Link>
            <div className="flex space-x-4">
              <Link
                href="/"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/callers"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Callers
              </Link>
              <Link
                href="/simulations"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Simulations
              </Link>
              <Link
                href="/analytics"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Analytics
              </Link>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

