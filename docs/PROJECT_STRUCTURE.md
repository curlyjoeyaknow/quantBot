# QuantBot Project Structure

## 📁 Directory Organization

```
quantBot/
├── 📁 src/                          # Main source code
│   ├── 📁 bot/                      # Telegram bot core
│   │   ├── bot.ts                   # Main bot entry point
│   │   ├── commands.ts              # Bot command handlers
│   │   ├── handlers.ts              # Message handlers
│   │   └── middleware.ts            # Bot middleware
│   ├── 📁 api/                      # External API integrations
│   │   ├── birdeye.ts              # Birdeye API client
│   │   ├── helius.ts               # Helius WebSocket client
│   │   └── base.ts                 # Base API client
│   ├── 📁 simulation/               # Trading simulation engine
│   │   ├── engine.ts               # Core simulation logic
│   │   ├── strategies.ts           # Trading strategies
│   │   ├── ichimoku.ts             # Ichimoku analysis
│   │   └── candles.ts              # OHLCV data handling
│   ├── 📁 analysis/                 # Data analysis modules
│   │   ├── historical.ts           # Historical analysis
│   │   ├── performance.ts          # Performance metrics
│   │   └── reporting.ts            # Report generation
│   ├── 📁 utils/                    # Utility functions
│   │   ├── database.ts             # Database operations
│   │   ├── validation.ts           # Input validation
│   │   ├── formatting.ts           # Data formatting
│   │   └── constants.ts            # App constants
│   └── 📁 types/                    # TypeScript type definitions
│       ├── bot.ts                  # Bot-related types
│       ├── simulation.ts           # Simulation types
│       └── api.ts                  # API types
├── 📁 scripts/                      # Standalone scripts
│   ├── 📁 analysis/                 # Analysis scripts
│   │   ├── analyze_ca_drops.js     # CA drops analysis
│   │   ├── analyze_by_caller.js    # Caller performance
│   │   └── analyze_time_period.js  # Time-based analysis
│   ├── 📁 data-processing/          # Data processing scripts
│   │   ├── extract_ca_drops.js     # Extract CA data
│   │   ├── clean_ca_drops.js       # Clean CA data
│   │   └── filter_ca_drops.js      # Filter CA data
│   └── 📁 simulation/               # Simulation scripts
│       ├── simulate_*.js           # Various simulation scripts
│       └── process_brook_*.js      # Brook data processing
├── 📁 data/                         # Data storage
│   ├── 📁 raw/                      # Raw data files
│   │   ├── ca_drops/               # CA drops data
│   │   ├── ohlcv/                  # OHLCV data
│   │   └── messages/               # Telegram messages
│   ├── 📁 processed/                # Processed data
│   │   ├── filtered/               # Filtered datasets
│   │   └── analyzed/               # Analysis results
│   ├── 📁 cache/                    # Cache files
│   │   └── ohlcv/                  # OHLCV cache
│   └── 📁 exports/                  # Export files
│       ├── csv/                    # CSV exports
│       ├── json/                   # JSON exports
│       └── reports/                # Analysis reports
├── 📁 docs/                         # Documentation
│   ├── 📁 api/                      # API documentation
│   ├── 📁 guides/                   # User guides
│   └── 📁 examples/                 # Code examples
├── 📁 tests/                        # Test files
│   ├── 📁 unit/                     # Unit tests
│   └── 📁 integration/              # Integration tests
├── 📁 config/                       # Configuration files
│   ├── default.json                # Default config
│   └── chains.json                 # Chain configurations
├── 📁 logs/                         # Log files
├── 📄 package.json                 # Package configuration
├── 📄 tsconfig.json                # TypeScript configuration
├── 📄 .env.example                 # Environment variables template
├── 📄 .gitignore                   # Git ignore rules
├── 📄 README.md                    # Main documentation
└── 📄 PROJECT_STRUCTURE.md         # This file
```

## 🎯 Organization Principles

### 1. **Separation of Concerns**
- **Bot Logic**: Telegram bot interactions and commands
- **API Layer**: External service integrations (Birdeye, Helius)
- **Simulation Engine**: Trading simulation and strategy logic
- **Analysis**: Data analysis and reporting
- **Utils**: Shared utilities and helpers

### 2. **Data Management**
- **Raw Data**: Unprocessed data from external sources
- **Processed Data**: Cleaned and filtered datasets
- **Cache**: Temporary data for performance
- **Exports**: Generated reports and analysis results

### 3. **Script Organization**
- **Analysis Scripts**: Standalone analysis tools
- **Data Processing**: Data cleaning and transformation
- **Simulation Scripts**: Various simulation scenarios

### 4. **Documentation Structure**
- **API Docs**: External API documentation
- **Guides**: User and developer guides
- **Examples**: Code examples and tutorials

## 🔄 Migration Plan

1. **Phase 1**: Create folder structure
2. **Phase 2**: Move and organize source code
3. **Phase 3**: Organize data files
4. **Phase 4**: Organize scripts
5. **Phase 5**: Update configuration and documentation
6. **Phase 6**: Add comprehensive code comments

## 📋 File Categories

### Source Code Files
- `src/bot/` - Core bot functionality
- `src/api/` - External API clients
- `src/simulation/` - Trading simulation engine
- `src/analysis/` - Data analysis modules
- `src/utils/` - Utility functions
- `src/types/` - TypeScript definitions

### Script Files
- `scripts/analysis/` - Analysis scripts
- `scripts/data-processing/` - Data processing scripts
- `scripts/simulation/` - Simulation scripts

### Data Files
- `data/raw/` - Raw data files
- `data/processed/` - Processed data
- `data/cache/` - Cache files
- `data/exports/` - Export files

### Configuration Files
- `config/` - Application configuration
- `package.json` - Package configuration
- `tsconfig.json` - TypeScript configuration
- `.env.example` - Environment template
