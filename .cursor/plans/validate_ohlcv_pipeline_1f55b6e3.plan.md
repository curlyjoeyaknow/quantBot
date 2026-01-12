---
name: Validate OHLCV Pipeline
overview: Systematically validate the OHLCV fetch and ingestion pipeline by testing each component individually with verification checks, before diagnosing coverage issues.
todos:
  - id: verify-clickhouse
    content: Test ClickHouse connectivity and verify ohlcv_candles schema
    status: completed
  - id: verify-birdeye-api
    content: Test Birdeye API fetch for single token (1 hour, 1m interval)
    status: completed
    dependencies:
      - verify-clickhouse
  - id: verify-storage-write
    content: Write test candles to ClickHouse and verify count stored
    status: completed
    dependencies:
      - verify-birdeye-api
  - id: verify-storage-read
    content: Read back stored candles and compare to original fetch
    status: completed
    dependencies:
      - verify-storage-write
  - id: test-single-ingestion
    content: Run ingestion workflow for ONE alert and verify end-to-end
    status: pending
    dependencies:
      - verify-storage-read
  - id: diagnose-gaps
    content: Validate slices and identify which tokens have gaps
    status: pending
    dependencies:
      - test-single-ingestion
  - id: compare-gap-sources
    content: Compare gap tokens in slices vs ClickHouse to identify root cause
    status: pending
    dependencies:
      - diagnose-gaps
  - id: test-refetch-gap
    content: Re-fetch ONE gap token to determine if Birdeye has the data
    status: pending
    dependencies:
      - compare-gap-sources
  - id: implement-fix
    content: Implement targeted fix based on diagnosis
    status: pending
    dependencies:
      - test-refetch-gap
---

