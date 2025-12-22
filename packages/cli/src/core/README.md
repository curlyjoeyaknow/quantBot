# Standard Command Wrapper Pattern

This directory contains the standard command wrapper pattern that makes it mechanically hard to screw up CLI command implementation.

## Core Principle

**Commander owns flags & parsing. Wrapper owns: canonical option shape (camelCase), value coercion, schema validation, error formatting, handler invocation.**

**Invariant: Normalization never renames keys. Ever.**

## The Pattern

### 1. Commander Defines Flags (Kebab-Case)

```typescript
const cmd = parent
  .command('sweep')
  .requiredOption('--calls-file <path>', 'Path to JSON file')
  .requiredOption('--intervals <json>', 'JSON array of intervals')
  .requiredOption('--lags-ms <json>', 'JSON array of lag values');
```

### 2. defineCommand() Wires Everything

```typescript
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceJson, coerceStringArray, coerceNumberArray } from '../core/coerce.js';
import { sweepCallsSchema } from '../command-defs/calls.js';

defineCommand(cmd, {
  name: 'sweep',
  packageName: 'calls',
  coerce: (raw) => ({
    ...raw,
    // Coerce JSON strings to arrays (Commander gives camelCase keys)
    intervals: raw.intervals ? coerceStringArray(raw.intervals, 'intervals') : undefined,
    lagsMs: raw.lagsMs ? coerceNumberArray(raw.lagsMs, 'lags-ms') : undefined,
  }),
  validate: (opts) => sweepCallsSchema.parse(opts),
  onError: die,
});
```

### 3. Schema Uses CamelCase (Matching Commander Output)

```typescript
export const sweepCallsSchema = z.object({
  callsFile: z.string().min(1), // camelCase, not 'calls-file'
  intervals: z.array(z.enum(['1m', '5m'])),
  lagsMs: z.array(z.coerce.number().int()),
  // ...
});
```

### 4. Handler Uses CamelCase

```typescript
export async function sweepCallsHandler(args: SweepCallsArgs, ctx: CommandContext) {
  const callsFile = args.callsFile; // camelCase
  const intervals = args.intervals;
  const lagsMs = args.lagsMs;
  // ...
}
```

## What This Guarantees

- ✅ Flags remain kebab-case (`--lags-ms`) for humans
- ✅ Options in code are camelCase (`opts.lagsMs`) for sanity
- ✅ JSON parsing happens once, in a single known place
- ✅ Schema validation always sees the correct shape
- ✅ New commands copy/paste this and stop inventing their own normalization
- ✅ No key renaming - normalization only coerces values

## Coercion Helpers

Use these in `coerce()` function:

- `coerceJson<T>(v, name)` - Parse JSON strings to objects/arrays (includes field name and input preview in errors)
- `coerceNumber(v, name)` - Coerce strings/numbers to numbers
- `coerceNumberArray(v, name)` - Coerce JSON strings or comma-separated strings to number arrays
- `coerceStringArray(v, name)` - Coerce JSON strings or comma-separated strings to string arrays
- `coerceBoolean(v, name)` - Coerce values to boolean (supports: true/false/1/0/yes/no/on/off, case-insensitive)

## Error Handling

Use `die` from `cliErrors.ts` for consistent error formatting:

```typescript
onError: die, // Formats error and exits with code 1
```

## Migration Checklist

When migrating an existing command:

1. ✅ Update schema to use camelCase (matching Commander output)
2. ✅ Update handler to use camelCase
3. ✅ Replace manual JSON parsing with `coerce()` function
4. ✅ Replace manual type coercion with coercion helpers
5. ✅ Use `defineCommand()` instead of manual `.action()` handler
6. ✅ Remove all key renaming logic (normalization never renames keys)

## Anti-Patterns (Never Do This)

### ❌ Don't Rename Keys

```typescript
// ❌ WRONG - Normalization should never rename keys
coerce: (raw) => ({
  'calls-file': raw.callsFile, // NO - don't rename
  'lags-ms': raw.lagsMs, // NO - don't rename
})
```

### ❌ Don't Parse JSON in Action Handler

```typescript
// ❌ WRONG - Do this in coerce(), not in action
.action(async (options) => {
  const intervals = JSON.parse(options.intervals); // NO
})
```

### ❌ Don't Use Kebab-Case in Schema

```typescript
// ❌ WRONG - Schema should match Commander output (camelCase)
export const schema = z.object({
  'calls-file': z.string(), // NO - use callsFile
  'lags-ms': z.array(z.number()), // NO - use lagsMs
});
```

## Arguments Support

For commands that use `.argument()`, use the `argsToOpts` hook:

```typescript
.argument('<addresses...>', 'Addresses to validate')
defineCommand(cmd, {
  name: 'validate-addresses',
  packageName: 'ingestion',
  argsToOpts: (args, rawOpts) => ({
    ...rawOpts,
    addresses: args[0] as string[], // Commander passes args as first param
  }),
  validate: (opts) => validateAddressesSchema.parse(opts),
  onError: die,
});
```

## Migration Status

✅ **Migration Complete** - All standard CLI commands have been migrated to use `defineCommand()`.

**Remaining exceptions** (intentionally left as-is):
- `simulation.create-strategy` - Interactive command that doesn't use `execute()`
- `telegram.tui` - Interactive TUI that builds custom argv

## Examples

See `packages/cli/src/commands/calls.ts` for a complete example of the `sweep` command using this pattern.

