# QuantBot Web Dashboard

Unified UI for the QuantBot project providing comprehensive analytics and performance tracking.

## Features

- **Dashboard**: Overview metrics including total calls, PNL, drawdown, and profit percentages
- **Caller History**: Complete history of all calls with filtering, sorting, and pagination
- **Recent Alerts**: Past week's alerts with current price and gain/loss tracking
- **Simulations**: View past simulation results and trade history
- **Optimizations**: Consolidated view of all optimization runs and their performance

## Setup

1. Install dependencies:
```bash
cd web
npm install
```

2. Set up environment variables:
Create a `.env.local` file with:
```
CALLER_DB_PATH=../caller_alerts.db
BIRDEYE_API_KEY=your_api_key_here
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## API Routes

The dashboard uses Next.js API routes to access data:

- `/api/caller-history` - Get caller history with filtering
- `/api/recent-alerts` - Get recent alerts (past week)
- `/api/simulations` - List all simulations
- `/api/simulations/[name]` - Get simulation details
- `/api/optimizations` - Get optimization results
- `/api/dashboard` - Get dashboard metrics

## Notes

- The API routes need access to the parent directory's databases and data files
- ClickHouse client integration may need path adjustments based on your setup
- Some metrics require additional calculation scripts to be run periodically

