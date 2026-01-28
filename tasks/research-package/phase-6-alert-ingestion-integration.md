# Phase VI: Alert Ingestion Integration

## Overview

| Attribute | Value |
|-----------|-------|
| **Phase** | VI |
| **Duration** | Week 6-7 |
| **Dependencies** | Phase I (Artifact Store Integration) |
| **Status** | 🔲 Pending |
| **Critical Path** | No (can run in parallel with Phase V, VII) |

---

## Objective

Integrate alert ingestion pipeline with the artifact store. All alerts are ingested as Parquet artifacts with deduplication at the artifact level.

---

## Current State

Existing alert artifacts in `/home/memez/opn/artifacts/alerts_v1/v1/`:
- 750 alert artifacts (day-partitioned by chain)
- Pattern: `alerts_v1__v1__day=2025-05-01_chain=solana__ch=ace42dc3.parquet`
- Sidecar JSON metadata alongside each Parquet file

---

## Deliverables

### 1. Alert Ingestion Handler

**File**: `packages/ingestion/src/handlers/ingest-telegram-alerts.ts`

**Purpose**: Pure handler for ingesting Telegram alerts as artifacts.

**Interface**:

```typescript
export interface IngestTelegramAlertsArgs {
  exportPath: string;
  chain: 'solana' | 'evm';
  date: string; // YYYY-MM-DD
}

export interface IngestTelegramAlertsResult {
  artifactId?: string;
  deduped: boolean;
  validCount: number;
  invalidCount: number;
  quarantinedIds?: string[];
}

export async function ingestTelegramAlertsHandler(
  args: IngestTelegramAlertsArgs,
  ctx: CommandContext
): Promise<IngestTelegramAlertsResult>;
```

**Pipeline**:

```
1. Load Telegram export JSON
2. Normalize to canonical schema
3. Validate alerts
4. Quarantine invalid alerts
5. Write valid alerts to temp Parquet
6. Publish via ArtifactStorePort
7. Cleanup temp file
8. Return result
```

---

### 2. Alert Normalization

**File**: `packages/ingestion/src/alerts/normalize.ts`

**Purpose**: Convert raw Telegram export to canonical alert schema.

**Canonical Schema**:

```typescript
interface CanonicalAlert {
  alert_ts_utc: string;      // ISO8601 timestamp
  chain: string;             // 'solana' | 'evm'
  mint: string;              // Full mint address (never truncated)
  alert_chat_id: number;     // Telegram chat ID
  alert_message_id: number;  // Telegram message ID
  alert_id: string;          // Content-derived stable ID
  caller_name_norm: string;  // Normalized caller name
  caller_id: string;         // Caller ID
  mint_source: string;       // How mint was extracted
  bot_name: string;          // Bot name
  run_id: string;            // Ingestion run ID
}
```

---

### 3. Alert Validation

**File**: `packages/ingestion/src/alerts/validate.ts`

**Purpose**: Validate alerts before publishing.

**Validations**:
- Required fields present
- Mint address valid (32-44 chars, base58)
- Timestamp valid
- Chain valid ('solana' or 'evm')
- No duplicate alert_id within batch

**Result**:

```typescript
interface ValidationResult {
  valid: CanonicalAlert[];
  invalid: InvalidAlert[];
}

interface InvalidAlert {
  alert: CanonicalAlert;
  reason: string;
}
```

---

### 4. Quarantine Handler

**File**: `packages/ingestion/src/alerts/quarantine.ts`

**Purpose**: Quarantine invalid alerts for review.

**Implementation**:

```typescript
export async function quarantineAlerts(
  invalid: InvalidAlert[],
  artifactStore: ArtifactStorePort,
  date: string,
  chain: string
): Promise<string[]> {
  // Write invalid alerts to temp file
  const tempPath = await writeTempParquet(invalid);
  
  // Publish to quarantine artifact type
  const result = await artifactStore.publishArtifact({
    artifactType: 'alerts_quarantine',
    schemaVersion: 1,
    logicalKey: `day=${date}/chain=${chain}/reason=validation_failed`,
    dataPath: tempPath,
    tags: {
      quarantine_reason: 'validation_failed',
      date,
      chain,
    },
    ...
  });
  
  return result.artifactId ? [result.artifactId] : [];
}
```

---

### 5. CLI Handler

**File**: `packages/cli/src/handlers/ingestion/ingest-telegram-alerts.ts`

**Purpose**: CLI wrapper for ingestion handler.

```typescript
export async function ingestTelegramAlertsCLIHandler(
  args: IngestTelegramAlertsArgs,
  ctx: CommandContext
) {
  // Get handler from ingestion package
  const { ingestTelegramAlertsHandler } = await import('@quantbot/ingestion');
  
  // Execute
  return await ingestTelegramAlertsHandler(args, ctx);
}
```

---

### 6. Command Registration

**File**: `packages/cli/src/commands/ingestion.ts` (extend)

**Command**:

```bash
quantbot ingestion alerts \
  --export <path> \
  --chain <solana|evm> \
  --date <YYYY-MM-DD>
```

---

## Tasks

### Task 6.1: Create Normalization Module
- [ ] Create `packages/ingestion/src/alerts/normalize.ts`
- [ ] Define canonical alert schema
- [ ] Implement Telegram export parsing
- [ ] Implement normalization logic
- [ ] Handle edge cases (missing fields, etc.)

### Task 6.2: Create Validation Module
- [ ] Create `packages/ingestion/src/alerts/validate.ts`
- [ ] Implement required field validation
- [ ] Implement mint address validation
- [ ] Implement timestamp validation
- [ ] Implement duplicate detection
- [ ] Return valid/invalid split

### Task 6.3: Create Quarantine Module
- [ ] Create `packages/ingestion/src/alerts/quarantine.ts`
- [ ] Implement temp Parquet writing
- [ ] Implement quarantine artifact publishing
- [ ] Add reason tracking

### Task 6.4: Create Ingestion Handler
- [ ] Create `packages/ingestion/src/handlers/ingest-telegram-alerts.ts`
- [ ] Implement full pipeline
- [ ] Use ArtifactStorePort
- [ ] Add logging
- [ ] Handle errors

### Task 6.5: Create CLI Handler
- [ ] Create `packages/cli/src/handlers/ingestion/ingest-telegram-alerts.ts`
- [ ] Wire to ingestion package

### Task 6.6: Register Command
- [ ] Update `packages/cli/src/commands/ingestion.ts`
- [ ] Add `alerts` subcommand
- [ ] Define schema

### Task 6.7: Write Unit Tests
- [ ] Test normalization
- [ ] Test validation
- [ ] Test quarantine
- [ ] Test handler

### Task 6.8: Write Integration Tests
- [ ] Test full pipeline with real export
- [ ] Verify artifact created
- [ ] Verify deduplication works
- [ ] Verify quarantine works

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/ingestion/src/alerts/normalize.ts` | Create | Normalization |
| `packages/ingestion/src/alerts/validate.ts` | Create | Validation |
| `packages/ingestion/src/alerts/quarantine.ts` | Create | Quarantine |
| `packages/ingestion/src/handlers/ingest-telegram-alerts.ts` | Create | Handler |
| `packages/cli/src/handlers/ingestion/ingest-telegram-alerts.ts` | Create | CLI handler |
| `packages/cli/src/commands/ingestion.ts` | Modify | Add command |
| `packages/ingestion/tests/unit/alerts/*.test.ts` | Create | Unit tests |
| `packages/ingestion/tests/integration/alerts.test.ts` | Create | Integration tests |

---

## Success Criteria

- [ ] Alerts ingested as artifacts
- [ ] Deduplication at artifact level works
- [ ] Invalid alerts quarantined
- [ ] Provenance tracked
- [ ] CLI command works
- [ ] Unit tests pass
- [ ] Integration tests pass

---

## Testing Strategy

### Unit Tests

```typescript
describe('normalizeAlerts', () => {
  it('should normalize Telegram export', () => {
    const raw = loadTelegramExport('./fixtures/export.json');
    const normalized = normalizeAlerts(raw, 'solana');
    
    expect(normalized[0]).toHaveProperty('alert_ts_utc');
    expect(normalized[0]).toHaveProperty('mint');
    expect(normalized[0].chain).toBe('solana');
  });
});

describe('validateAlerts', () => {
  it('should reject invalid mint addresses', () => {
    const alerts = [{ mint: 'invalid', ... }];
    const { valid, invalid } = validateAlerts(alerts);
    
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].reason).toContain('mint');
  });
});
```

### Integration Tests

```typescript
describe('ingestTelegramAlerts', () => {
  it('should create artifact from export', async () => {
    const result = await ingestTelegramAlertsHandler({
      exportPath: './fixtures/telegram-export.json',
      chain: 'solana',
      date: '2025-06-01',
    }, ctx);
    
    expect(result.artifactId).toBeDefined();
    expect(result.validCount).toBeGreaterThan(0);
    
    // Verify artifact exists
    const artifact = await ctx.services.artifactStore()
      .getArtifact(result.artifactId!);
    expect(artifact.artifactType).toBe('alerts_v1');
  });
});
```

---

## Migration Strategy

### Existing Alerts

The 750 existing alert artifacts were already created using this pattern. No migration needed for existing artifacts.

### Future Ingestion

All future alert ingestion should use this handler to ensure:
- Consistent artifact format
- Deduplication
- Lineage tracking
- Quarantine for invalid alerts

---

## Mint Address Handling

**Critical Rule**: ⚠️ NEVER MODIFY MINT ADDRESSES

```typescript
// ✅ Correct - preserve exact case and length
const mint = raw.mint_address;

// ❌ Wrong - truncation
const mint = raw.mint_address.slice(0, 8);

// ❌ Wrong - case change
const mint = raw.mint_address.toLowerCase();
```

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Telegram export format changes | Medium | Medium | Flexible parsing, validate structure |
| Duplicate detection misses | Low | Medium | Content-based deduplication at artifact level |
| Large export files | Low | Low | Streaming processing |

---

## Acceptance Checklist

- [ ] All deliverables created
- [ ] All tasks completed
- [ ] All success criteria met
- [ ] Mint addresses preserved correctly
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Code review completed
- [ ] Build succeeds

---

## Next Phase

Phase VI can run in parallel with Phases V and VII. After Phase VII is complete, the research package integration is finished.

