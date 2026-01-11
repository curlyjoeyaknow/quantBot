# CLI Quality Gate

The CLI package has a dedicated CI quality gate that ensures all commands follow the handler-first architecture and maintain code quality standards.

## CI Workflow

The `.github/workflows/test.yml` includes a `cli-quality` job that runs on every push and pull request.

### Quality Checks

1. **Build** - Ensures TypeScript compiles successfully

   ```bash
   pnpm --filter @quantbot/cli build
   ```

2. **Type Check** - Validates TypeScript types

   ```bash
   pnpm --filter @quantbot/cli typecheck
   ```

3. **Lint** - Checks code style and best practices

   ```bash
   pnpm --filter @quantbot/cli lint
   ```

4. **Format Check** - Ensures code formatting consistency

   ```bash
   pnpm --filter @quantbot/cli format:check
   ```

5. **Tests** - Runs all CLI tests

   ```bash
   pnpm --filter @quantbot/cli test --run
   ```

6. **Smoke Test** - Validates command registry integrity

   ```bash
   pnpm --filter @quantbot/cli test command-registry-smoke.test.ts --run
   ```

## What the Smoke Test Validates

The command registry smoke test (`tests/unit/command-registry-smoke.test.ts`) ensures:

- ✅ All registered commands have a schema
- ✅ All registered commands have a handler
- ✅ All handlers are callable functions
- ✅ All commands can be built into Commander without errors
- ✅ All commands are accessible via the registry
- ✅ No duplicate command names within packages
- ✅ All command schemas are valid Zod schemas

## Running Locally

Before pushing, run the full quality check:

```bash
cd packages/cli
npm run quality:check
```

This runs:

- Format check
- Lint
- Type check
- Tests

## What Happens if Checks Fail

If any CI check fails:

- The PR cannot be merged (if branch protection is enabled)
- The failure is reported in the GitHub Actions UI
- The specific error is shown in the workflow logs

## Adding New Commands

When adding a new command, ensure:

1. Handler is created in `src/handlers/{package}/{command-name}.ts`
2. Schema is defined in `src/command-defs/{package}.ts` or `src/commands/{package}.ts`
3. Command is registered in `src/commands/{package}.ts`
4. Handler has unit tests in `tests/unit/handlers/{package}/{command-name}.test.ts`
5. Smoke test passes (automatically validates registration)

The smoke test will catch any missing pieces automatically.
