# ESM-Only Policy

## Policy

**QuantBot uses ESM (ECMAScript Modules) exclusively. CommonJS `require()` is forbidden except for specific exceptions.**

## Allowed Exceptions

1. **ESM interop with CJS packages** - Using `createRequire()` for importing CommonJS-only packages:

   ```typescript
   import { createRequire } from 'module';
   const require = createRequire(import.meta.url);
   const CJSOnlyPackage = require('cjs-only-package');
   ```

2. **Test utilities** - Test files may use `require()` for Node.js built-ins when needed for dynamic file operations:

   ```typescript
   const fs = require('fs'); // Acceptable in test utilities
   ```

## Forbidden Patterns

- ❌ `require()` for workspace packages - Use ESM imports
- ❌ `require()` for npm packages that support ESM - Use ESM imports
- ❌ `module.exports` - Use `export` instead
- ❌ `exports.` - Use named exports instead

## Enforcement

- ESLint rule: `no-restricted-syntax` to catch `require()` calls (except allowed patterns)
- CI check: Verify no `require()` calls in source files (tests have exceptions)

## Migration Status

Most codebase is ESM. Remaining `require()` calls are:

- Test utilities (acceptable)
- ESM interop with CJS packages (acceptable)
- Legacy code (to be migrated)
