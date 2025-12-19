"""
Tests for DuckDB Storage Service

Tests ensure:
- Wrapper maintains backward compatibility
- Separation of concerns (storage only, no ingestion)
- Contract hygiene (Pydantic validation, JSON output)
- Each layer produces expected output for next handler
"""

