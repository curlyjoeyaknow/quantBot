"use client"

import { TrendingUp, Moon, Sun } from "lucide-react"
import type { PageType } from "@/components/dashboard-client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface NavbarProps {
  currentPage: PageType
  onPageChange: (page: PageType) => void
  isDark: boolean
  onToggleTheme: () => void
}

export function Navbar({ currentPage, onPageChange, isDark, onToggleTheme }: NavbarProps) {
  const navItems: { id: PageType; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "analysis", label: "Analysis" },
    { id: "trades", label: "Trade History" },
    { id: "transactions", label: "Transactions" },
    { id: "expenses", label: "Expenses" },
  ]

  return (
    <nav className="fixed top-0 left-0 right-0 bg-background shadow-sm z-50 border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">QuantBot</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-6">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onPageChange(item.id)}
                  className={cn(
                    "py-5 transition-colors text-muted-foreground hover:text-foreground",
                    currentPage === item.id && "border-b-2 border-primary text-foreground font-semibold"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleTheme}
              className="ml-2"
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>
    </nav>
  )
}
