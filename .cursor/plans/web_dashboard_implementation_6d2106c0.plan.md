---
name: Web Dashboard Implementation
overview: Create a comprehensive Next.js-based web dashboard for QuantBot analytics, simulation visualization, and caller performance metrics. The dashboard will integrate with existing analytics and simulation services, following the ports/adapters architecture pattern.
todos:
  - id: phase1-package-setup
    content: Create @quantbot/web package structure with Next.js 16, TypeScript, Tailwind CSS, and dependencies
    status: completed
  - id: phase1-layout
    content: Build root layout, navigation, and dashboard layout components
    status: completed
    dependencies:
      - phase1-package-setup
  - id: phase1-types
    content: Create shared types and utilities (re-export from analytics/simulation packages)
    status: completed
    dependencies:
      - phase1-package-setup
  - id: phase2-analytics-api
    content: Implement analytics API routes (dashboard summary, callers, calls, ATH distribution)
    status: completed
    dependencies:
      - phase1-types
  - id: phase3-simulation-api
    content: Implement simulation API routes (runs list, run details, results, events)
    status: completed
    dependencies:
      - phase1-types
  - id: phase4-dashboard-overview
    content: Build dashboard overview page with system metrics, top callers, ATH distribution, recent calls
    status: completed
    dependencies:
      - phase2-analytics-api
  - id: phase4-caller-page
    content: Build caller performance page with metrics table, detail view, and performance charts
    status: completed
    dependencies:
      - phase2-analytics-api
  - id: phase4-simulation-page
    content: Build simulation visualization page with runs list, detail view, PnL charts, and trade timeline
    status: completed
    dependencies:
      - phase3-simulation-api
  - id: phase5-chart-components
    content: Create Recharts-based chart components (line, bar, scatter, pie) with responsive design
    status: completed
    dependencies:
      - phase4-dashboard-overview
  - id: phase6-data-tables
    content: Build reusable data table components with sorting, pagination, and filtering
    status: completed
    dependencies:
      - phase4-caller-page
      - phase4-simulation-page
  - id: phase7-styling
    content: Implement design system, responsive layout, loading states, and error boundaries
    status: completed
    dependencies:
      - phase5-chart-components
      - phase6-data-tables
  - id: phase8-integration
    content: Integrate with build system, configure deployment, add error handling and logging
    status: completed
    dependencies:
      - phase7-styling
  - id: phase9-documentation
    content: Write package README, component documentation, and usage examples
    status: completed
    dependencies:
      - phase8-integration
---

# Web Dashboard Implementation Plan

## Overview

Build `@quantbot/web` - a Next.js-based analytics dashboard that visualizes:

- **Caller Performance**: Win rates, ATH multiples, time-to-ATH metrics
- **Simulation Results**: Strategy backtest results, PnL charts, trade events
- **Analytics Overview**: System metrics, ATH distributions, recent calls

## Architecture

The dashboard follows the existing architecture patterns:

```
@quantbot/web (Next.js App Router)
├── Server Components (data fetching)
├── Client Components (interactive charts)
└── API Routes (thin adapters to @quantbot/api or direct service calls)

Data Flow:
Dashboard → API Routes → AnalyticsEngine/Simulation Services → DuckDB → UI
```

### Key Principles

1. **Server Components by Default**: Fetch data in server components, pass to client components for interactivity
2. **API Routes as Thin Adapters**: API routes call existing services, format responses for frontend
3. **Type Safety**: Share types from `@quantbot/analytics` and `@quantbot/simulation`
4. **No Business Logic in UI**: All analytics/simulation logic stays in existing packages

## Phase 1: Foundation & Setup

### 1.1 Create Package Structure

**Files to Create:**

- `packages/web/package.json` - Next.js 16, React 19, Tailwind CSS, Recharts
- `packages/web/tsconfig.json` - Extends base config, Next.js settings
- `packages/web/next.config.js` - Next.js configuration
- `packages/web/tailwind.config.js` - Tailwind setup matching templates
- `packages/web/app/layout.tsx` - Root layout with navigation
- `packages/web/app/page.tsx` - Dashboard home page

**Dependencies:**

- `next@16.0.7`, `react@19.2.0`, `react-dom@19.2.0`
- `@quantbot/analytics`, `@quantbot/simulation`, `@quantbot/storage` (workspace:*)
- `recharts` (from templates), `tailwindcss`, `lucide-react`
- `zod` for API route validation

### 1.2 Navigation & Layout

**Components:**

- `app/components/layout/Navbar.tsx` - Top navigation
- `app/components/layout/Sidebar.tsx` - Side navigation (optional)
- `app/components/layout/DashboardLayout.tsx` - Main layout wrapper

**Routes:**

- `/` - Dashboard overview
- `/callers` - Caller performance
- `/simulations` - Simulation results
- `/analytics` - Analytics deep dive

### 1.3 Shared Types & Utilities

**Files:**

- `app/lib/types.ts` - Re-export types from `@quantbot/analytics` and `@quantbot/simulation`
- `app/lib/api-client.ts` - Type-safe API client utilities
- `app/lib/format.ts` - Number/date formatting utilities

## Phase 2: Analytics API Routes

### 2.1 Analytics Endpoints

**File:** `app/api/analytics/route.ts`

**Endpoints:**

- `GET /api/analytics` - Get dashboard summary
- `GET /api/analytics/callers` - Get caller metrics
- `GET /api/analytics/calls` - Get call performance data
- `GET /api/analytics/ath-distribution` - Get ATH distribution buckets

**Implementation:**

- Import `AnalyticsEngine` from `@quantbot/analytics`
- Create engine instance, call `analyzeCalls()` with query params
- Return JSON-serializable results (convert Date to ISO strings)
- Handle errors with proper status codes

### 2.2 Caller Performance Endpoint

**File:** `app/api/analytics/callers/route.ts`

**Query Params:**

- `from` (ISO date string, optional)
- `to` (ISO date string, optional)
- `callerName` (string, optional)

**Response:**

```typescript
{
  callers: CallerMetrics[];
  total: number;
}
```

### 2.3 Call Performance Endpoint

**File:** `app/api/analytics/calls/route.ts`

**Query Params:**

- `from`, `to`, `callerName`, `limit`, `offset`

**Response:**

```typescript
{
  calls: CallPerformance[];
  total: number;
  metadata: { processingTimeMs: number };
}
```

## Phase 3: Simulation API Routes

### 3.1 Simulation Runs Endpoint

**File:** `app/api/simulations/runs/route.ts`

**Endpoints:**

- `GET /api/simulations/runs` - List simulation runs
- `GET /api/simulations/runs/[runId]` - Get run details

**Implementation:**

- Use `SimulationRunsRepository` from `@quantbot/storage`
- Query DuckDB for runs with filters (strategy, caller, date range)
- Return paginated results

### 3.2 Simulation Results Endpoint

**File:** `app/api/simulations/runs/[runId]/results/route.ts`

**Response:**

- Run metadata (strategy, dates, totals)
- Results array (per-call simulation results)
- Metrics (PnL stats, win rate, etc.)

### 3.3 Simulation Events Endpoint

**File:** `app/api/simulations/runs/[runId]/events/route.ts`

**Response:**

- Trade events (entries, exits, re-entries)
- Time-series data for charts
- Event metadata (prices, quantities, PnL)

## Phase 4: Dashboard Components

### 4.1 Dashboard Overview Page

**File:** `app/page.tsx` (Server Component)

**Sections:**

1. **System Metrics Card** - Total calls, win rate, avg multiple
2. **Top Callers Table** - Top 10 callers by total calls
3. **ATH Distribution Chart** - Bar chart of ATH buckets
4. **Recent Calls Table** - Last 50 calls with performance

**Data Fetching:**

- Call `GET /api/analytics` for dashboard summary
- Use `AnalyticsEngine.getDashboard()` or direct API call

### 4.2 Caller Performance Page

**File:** `app/callers/page.tsx`

**Components:**

- `CallerMetricsTable.tsx` - Sortable table of caller metrics
- `CallerDetailCard.tsx` - Detailed metrics for selected caller
- `CallerPerformanceChart.tsx` - Time-series of caller performance

**Features:**

- Filter by date range
- Sort by win rate, total calls, avg multiple
- Click caller to see detailed view
- Export to CSV (optional)

### 4.3 Simulation Visualization Page

**File:** `app/simulations/page.tsx`

**Components:**

- `SimulationRunsList.tsx` - List of simulation runs
- `SimulationRunDetail.tsx` - Detailed run view
- `PnLChart.tsx` - Cumulative PnL over time
- `TradeEventsTimeline.tsx` - Visual timeline of trades
- `MetricsCard.tsx` - Key metrics (Sharpe, drawdown, win rate)

**Features:**

- Filter runs by strategy, caller, date range
- View individual run details
- Interactive charts (zoom, pan)
- Compare multiple runs (optional)

### 4.4 Analytics Deep Dive Page

**File:** `app/analytics/page.tsx`

**Components:**

- `AthDistributionChart.tsx` - ATH bucket distribution
- `TimeToAthChart.tsx` - Time-to-ATH histogram
- `CallPerformanceScatter.tsx` - Scatter plot (time vs multiple)
- `CallerComparisonChart.tsx` - Compare multiple callers

## Phase 5: Chart Components

### 5.1 Recharts Integration

**Components:**

- `app/components/charts/LineChart.tsx` - Reusable line chart wrapper
- `app/components/charts/BarChart.tsx` - Bar chart wrapper
- `app/components/charts/ScatterChart.tsx` - Scatter plot wrapper
- `app/components/charts/PieChart.tsx` - Pie chart wrapper

**Features:**

- Responsive design
- Dark mode support
- Tooltip customization
- Export to PNG (optional)

### 5.2 Specific Chart Components

**Files:**

- `app/components/charts/PnLChart.tsx` - Cumulative PnL line chart
- `app/components/charts/AthDistributionChart.tsx` - ATH buckets bar chart
- `app/components/charts/CallerMetricsChart.tsx` - Multi-metric comparison
- `app/components/charts/TradeTimelineChart.tsx` - Trade events over time

## Phase 6: Data Tables

### 6.1 Reusable Table Components

**Components:**

- `app/components/tables/DataTable.tsx` - Generic sortable/filterable table
- `app/components/tables/CallsTable.tsx` - Call performance table
- `app/components/tables/CallersTable.tsx` - Caller metrics table
- `app/components/tables/SimulationRunsTable.tsx` - Simulation runs table

**Features:**

- Client-side sorting
- Pagination
- Column filtering (optional)
- Row selection (optional)

## Phase 7: Styling & UX

### 7.1 Design System

**Files:**

- `app/styles/globals.css` - Global styles, Tailwind imports
- `app/components/ui/` - Reusable UI components (from templates)
  - Button, Card, Badge, Input, Select, etc.

### 7.2 Responsive Design

- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
- Collapsible sidebar on mobile
- Stack charts vertically on small screens

### 7.3 Loading & Error States

**Components:**

- `app/components/ui/LoadingSpinner.tsx`
- `app/components/ui/ErrorBoundary.tsx`
- `app/components/ui/EmptyState.tsx`

**Implementation:**

- Suspense boundaries for async data
- Error boundaries for component errors
- Loading skeletons for better UX

## Phase 8: Integration & Testing

### 8.1 API Integration

- Ensure API routes work with existing services
- Handle authentication (if needed)
- Add request validation with Zod
- Error handling and logging

### 8.2 Build Configuration

**Files:**

- Update root `package.json` build script to include `@quantbot/web`
- Add `pnpm --filter @quantbot/web build` to build:ordered
- Configure Next.js output (standalone mode for deployment)

### 8.3 Development Setup

**Scripts:**

- `pnpm --filter @quantbot/web dev` - Start dev server
- `pnpm --filter @quantbot/web build` - Production build
- `pnpm --filter @quantbot/web start` - Start production server

**Environment:**

- `NEXT_PUBLIC_API_URL` - API server URL (default: http://localhost:3000)
- `NODE_ENV` - Environment mode

## Phase 9: Documentation

### 9.1 Package README

**File:** `packages/web/README.md`

**Contents:**

- Overview and features
- Setup instructions
- Development workflow
- Deployment guide
- API route documentation

### 9.2 Component Documentation

- JSDoc comments for all components
- Props documentation
- Usage examples
- Storybook (optional, future enhancement)

## Implementation Order

1. **Phase 1** - Foundation (package setup, layout, navigation)
2. **Phase 2** - Analytics API routes (connect to AnalyticsEngine)
3. **Phase 4** - Dashboard overview page (basic visualization)
4. **Phase 5** - Chart components (Recharts integration)
5. **Phase 3** - Simulation API routes
6. **Phase 4** (continued) - Simulation visualization page
7. **Phase 6** - Data tables
8. **Phase 7** - Styling and UX polish
9. **Phase 8** - Integration and testing
10. **Phase 9** - Documentation

## Key Files Reference

**Existing Services:**

- `packages/analytics/src/engine/AnalyticsEngine.ts` - Analytics engine
- `packages/simulation/src/types/results.ts` - Simulation result types
- `packages/storage/src/duckdb/repositories/` - Data repositories
- `packages/api/src/routes/` - Existing API routes (reference)

**New Package Structure:**

```
packages/web/
├── app/
│   ├── api/
│   │   ├── analytics/
│   │   │   ├── route.ts
│   │   │   ├── callers/route.ts
│   │   │   └── calls/route.ts
│   │   └── simulations/
│   │       └── runs/
│   │           ├── route.ts
│   │           └── [runId]/
│   │               ├── route.ts
│   │               └── results/route.ts
│   ├── callers/
│   │   └── page.tsx
│   ├── simulations/
│   │   └── page.tsx
│   ├── analytics/
│   │   └── page.tsx
│   ├── components/
│   │   ├── charts/
│   │   ├── tables/
│   │   ├── layout/
│   │   └── ui/
│   ├── lib/
│   │   ├── types.ts
│   │   ├── api-client.ts
│   │   └── format.ts
│   └── layout.tsx
├── package.json
├── tsconfig.json
├── next.config.js
└── tailwind.config.js
```

## Architecture Compliance

- **No Business Logic in UI**: All analytics/simulation logic in existing packages
- **API Routes as Adapters**: Thin wrappers around existing services
- **Type Safety**: Reuse types from `@quantbot/analytics` and `@quantbot/simulation`
- **Server Components**: Default to server components, client only for interactivity
- **Error Handling**: Proper error boundaries and API error responses