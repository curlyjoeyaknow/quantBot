# ClickHouse Parameterized Queries

## Current Status

ClickHouse JavaScript client (`@clickhouse/client`) supports parameterized queries via the `query_params` option.

### Example Usage

```typescript
const result = await ch.query({
  query: 'SELECT * FROM table WHERE id = {id:UInt64} AND name = {name:String}',
  query_params: { id: 123, name: 'test' },
  format: 'JSONEachRow',
});
```

## Current Implementation

### String Interpolation with Escaping (Current Approach)

Most queries use string interpolation with our query builder utilities that properly escape values:

```typescript
const query = `
  SELECT * FROM table
  WHERE ${buildTokenAddressWhereClause(tokenAddress)}
    AND ${buildChainWhereClause(chain)}
`;
```

**Benefits:**
- ✅ Prevents SQL injection via proper escaping
- ✅ Simple and readable
- ✅ Works with complex WHERE clauses
- ✅ Already tested and verified

**Status:** This approach is secure and performant. No migration required.

### Parameterized Queries (Available but Not Required)

Some repositories (e.g., `RunRepository.ts`) already use parameterized queries for specific cases:

```typescript
const result = await this.ch.query({
  query: sql,
  query_params: params,
  format: 'JSONEachRow',
});
```

**When to Use:**
- Simple queries with few parameters
- Queries that benefit from query plan caching
- When ClickHouse query plan optimization is important

**When NOT to Use:**
- Complex WHERE clauses with multiple conditions
- Dynamic query building (our query builder pattern)
- Queries that are already performant with string interpolation

## Recommendation

**Keep current approach** (string interpolation with proper escaping):
- ✅ Already secure (comprehensive SQL injection tests)
- ✅ Works well with our query builder pattern
- ✅ No performance issues observed
- ✅ Simpler to maintain

**Consider parameterized queries** for:
- New simple queries with 1-2 parameters
- Queries that would benefit from ClickHouse query plan caching
- Future optimization if query planning becomes a bottleneck

## Migration Path (If Needed)

If we decide to migrate to parameterized queries in the future:

1. Update query builder to support parameterized mode
2. Migrate simple queries first
3. Keep complex queries with string interpolation
4. Add performance benchmarks to verify improvements

## References

- ClickHouse JavaScript Client: https://github.com/ClickHouse/clickhouse-js
- Current query builder: `packages/storage/src/utils/query-builder.ts`
- SQL injection tests: `packages/storage/tests/security/sql-injection.test.ts`

