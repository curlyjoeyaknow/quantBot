# QuantBot Development Guide

## 🏗️ Project Architecture

QuantBot follows a modular architecture with clear separation of concerns:

### Core Modules

- **Bot Core** (`src/bot/`) - Telegram bot interactions and command handling
- **API Layer** (`src/api/`) - External service integrations (Birdeye, Helius)
- **Simulation Engine** (`src/simulation/`) - Trading simulation and strategy logic
- **Analysis** (`src/analysis/`) - Data analysis and reporting modules
- **Utils** (`src/utils/`) - Shared utilities and database operations
- **Types** (`src/types/`) - TypeScript type definitions

### Scripts Organization

- **Analysis Scripts** (`scripts/analysis/`) - Standalone analysis tools
- **Data Processing** (`scripts/data-processing/`) - Data cleaning and transformation
- **Simulation Scripts** (`scripts/simulation/`) - Various simulation scenarios

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Telegram Bot Token
- Birdeye API Key
- Helius API Key

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd quantBot

# Install dependencies
npm install

# Copy environment template
cp env.example .env

# Edit environment variables
nano .env
```

### Development Setup

```bash
# Start development server
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test

# Run analysis
npm run analysis

# Extract CA data
npm run extract

# Run simulation
npm run simulate
```

## 📁 Directory Structure

```
quantBot/
├── src/                    # Main source code
│   ├── bot/                # Bot core functionality
│   ├── api/                # External API clients
│   ├── simulation/         # Trading simulation engine
│   ├── analysis/           # Data analysis modules
│   ├── utils/              # Utility functions
│   └── types/              # TypeScript definitions
├── scripts/                # Standalone scripts
│   ├── analysis/           # Analysis tools
│   ├── data-processing/    # Data processing
│   └── simulation/         # Simulation scripts
├── data/                   # Data storage
│   ├── raw/                # Raw data files
│   ├── processed/          # Processed data
│   ├── cache/              # Cache files
│   └── exports/            # Export files
├── docs/                   # Documentation
├── tests/                  # Test files
├── config/                 # Configuration files
└── logs/                   # Log files
```

## 🔧 Configuration

### Environment Variables

Key environment variables in `.env`:

```env
# Bot Configuration
BOT_TOKEN=your_telegram_bot_token
TELEGRAM_DEFAULT_CHAT=-1002523160967
ADMIN_USERS=123456789,987654321

# API Keys
BIRDEYE_API_KEY=your_birdeye_api_key
HELIUS_API_KEY=your_helius_api_key

# Database
DATABASE_PATH=data/quantbot.db

# Simulation Settings
DEFAULT_INITIAL_BALANCE=100
DEFAULT_POSITION_SIZE=2.5
DEFAULT_SLIPPAGE=0.03
DEFAULT_FEES=0.005
```

### Configuration Files

- `config/default.json` - Default application configuration
- `config/chains.json` - Blockchain configurations

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- --testNamePattern="simulation"
```

### Test Structure

```
tests/
├── unit/                   # Unit tests
│   ├── bot/               # Bot tests
│   ├── simulation/        # Simulation tests
│   └── utils/             # Utility tests
└── integration/           # Integration tests
    ├── api/               # API integration tests
    └── database/          # Database tests
```

## 📊 Data Management

### Data Flow

1. **Raw Data** → `data/raw/` - Unprocessed data from external sources
2. **Processing** → `scripts/data-processing/` - Data cleaning and transformation
3. **Processed Data** → `data/processed/` - Cleaned and filtered datasets
4. **Analysis** → `scripts/analysis/` - Data analysis and insights
5. **Exports** → `data/exports/` - Generated reports and results

### Database Schema

The bot uses SQLite with the following main tables:

- `strategies` - Custom trading strategies
- `simulation_runs` - Historical simulation results
- `simulation_events` - Detailed simulation events
- `ca_tracking` - Active CA monitoring entries
- `price_updates` - Real-time price data
- `alerts_sent` - Alert history

## 🔌 API Integration

### Birdeye API

- Token metadata fetching
- OHLCV candle data
- Multi-chain support
- Rate limiting and caching

### Helius WebSockets

- Real-time price updates
- Automatic reconnection
- Efficient subscription management

## 🚀 Deployment

### Production Build

```bash
# Build for production
npm run build

# Start production server
npm start
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
COPY config/ ./config/
COPY data/ ./data/
EXPOSE 3000
CMD ["npm", "start"]
```

## 🛠️ Development Guidelines

### Code Style

- Use TypeScript for all source code
- Follow ESLint configuration
- Use Prettier for code formatting
- Write comprehensive JSDoc comments

### Git Workflow

1. Create feature branches from `main`
2. Use descriptive commit messages
3. Run tests before committing
4. Create pull requests for code review

### Error Handling

- Use try-catch blocks for async operations
- Log errors with appropriate context
- Provide user-friendly error messages
- Implement graceful degradation

## 📈 Performance Optimization

### Caching Strategy

- CSV-based OHLCV caching with 24-hour expiry
- Intelligent cache extension for active simulations
- Memory-efficient data structures
- Reduced API calls through smart caching

### Monitoring Efficiency

- WebSocket-based real-time updates
- Smart alert deduplication
- Batch processing for summaries
- Connection pooling for database operations

## 🔍 Debugging

### Logging

- Structured logging with different levels
- Log rotation and archival
- Performance metrics logging
- Error tracking and reporting

### Debug Commands

```bash
# Enable debug mode
DEBUG=true npm run dev

# View logs
tail -f logs/quantbot.log

# Database inspection
sqlite3 data/quantbot.db ".tables"
```

## 📚 Additional Resources

- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [Birdeye API Documentation](https://docs.birdeye.so/)
- [Helius API Documentation](https://docs.helius.xyz/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
