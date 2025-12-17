# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **CRITICAL**: Fixed SQL injection vulnerability in ClickHouse queries - now uses parameterized queries with `{param:Type}` syntax
- **CRITICAL**: Mitigated InfluxDB query injection risk with input validation and string escaping (Flux limitation - best possible mitigation)

### Changed

- **CRITICAL**: Improved EventBus type safety - `EventHandler<T>` now defaults to `unknown` instead of `any`, uses `ApplicationEvent` for better type inference
- **CRITICAL**: Fixed database function type safety - `saveStrategy` and `saveCADrop` now use `Strategy[]` and `StopLossConfig` instead of `any`
- **CRITICAL**: Fixed all database function return type JSDoc comments to match actual return types
- Standardized error handling across codebase - replaced generic `Error` with `AppError` subclasses (`ValidationError`, `NotFoundError`, `ConfigurationError`, `ApiError`, `DatabaseError`, `TimeoutError`, `ServiceUnavailableError`) for better error clarity and debugging (packages/cli, packages/utils, packages/storage, packages/api-clients, packages/workflows, packages/ingestion, packages/ohlcv, packages/simulation, packages/core)
- Removed deprecated CSV cache system - all OHLCV data now uses ClickHouse via StorageEngine (packages/simulation, packages/ohlcv)

### Fixed

- **CRITICAL**: Fixed EventBus memory leak - event history now optional, periodic cleanup implemented, `clearHistory()` method added
- **CRITICAL**: Fixed EventBus HandlerMap memory leak - `removeAllListeners()` now clears handlerMap, periodic cleanup for orphaned handlers
- **CRITICAL**: Fixed RateLimitingMiddleware memory leak - added `cleanupExpiredWindows()` with periodic cleanup every 100 events
- **CRITICAL**: Fixed MetricsMiddleware memory leak - added max size limit (1000), TTL support (1 hour), automatic cleanup
- **CRITICAL**: Fixed WebSocket event listener memory leaks - added `cleanupWebSocket()` method to all WebSocket implementations (helius-monitor, helius-recorder, tenkan-kijun-alert-service, live-trade-alert-service)
- **CRITICAL**: Fixed CAMonitoringService EventEmitter memory leak - added `shutdown()` method to remove all listeners and clear active CAs

### Changed

- Refactored `BirdeyeClient` and `HeliusRestClient` to extend `BaseApiClient` - eliminated code duplication
- EventBus history is now optional via constructor parameter `enableHistory`
- EventBus now supports periodic cleanup via `cleanupIntervalMs` constructor option

### Added

- `@quantbot/api` package - Fastify-based REST API backend
- OpenAPI/Swagger documentation for API endpoints (`/api/docs`)
- StorageEngine pattern - Unified interface for all storage operations
- Comprehensive API routes for OHLCV, tokens, calls, simulations, and ingestion
- CHANGELOG.md - Version history tracking
- Security tests for ClickHouse parameterized queries (`OhlcvRepository.security.test.ts`)
- Memory leak prevention tests for EventBus, WebSocket cleanup, and CAMonitoringService
- `.cursor/rules/changelog-enforcement.mdc` - Enforces CHANGELOG updates
- `.cursor/rules/todo-tracking.mdc` - Enforces TODO completion tracking
- `.cursor/rules/documentation-organization.mdc` - Enforces documentation structure

### Changed

- Refactored OHLCV package to use StorageEngine instead of direct database calls
- Consolidated all storage operations into `@quantbot/storage` package
- Moved EventBus from `@quantbot/events` to `@quantbot/utils/events`
- Updated all packages to use direct imports instead of re-export packages

### Removed

- `@quantbot/data` package - Consolidated into `@quantbot/storage` and `@quantbot/api-clients`
- `@quantbot/events` package - Moved EventBus to `@quantbot/utils/events`
- `@quantbot/services` package - Services now in specialized packages

## [1.0.3] - 2025-12-11

### Added

- Package consolidation and refactoring
- StorageEngine pattern implementation
- Backend REST API with Fastify
- Updated documentation (README, ARCHITECTURE, TODO)

### Changed

- Major package restructuring for better separation of concerns
- All OHLCV operations now use StorageEngine
- Improved dependency management

### Fixed

- Import paths updated across 40+ files
- Test mocks updated to use StorageEngine
- Package.json dependencies cleaned up

## [1.0.2] - Previous Release

### Added

- Initial package structure
- OHLCV data management
- Simulation engine
- Monitoring services

## [1.0.1] - Previous Release

### Added

- Basic bot functionality
- Telegram integration
- Birdeye API integration

## [1.0.0] - Initial Release

### Added

- Initial project setup
- Core trading simulation functionality
- Database integration (PostgreSQL, ClickHouse)
- Basic monitoring capabilities

---

## Types of Changes

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes
