#!/usr/bin/env tsx

/**
 * CI Check: No Live Trading Code
 *
 * This script fails the build if any live trading code patterns are detected.
 * QuantBot is a simulation lab only - it must never sign transactions or submit to networks.
 *
 * Checks for forbidden patterns:
 * - Keypair.fromSecretKey
 * - sendTransaction, sendRawTransaction
 * - signTransaction, signAllTransactions
 * - process.env.*PRIVATE*, *SECRET*, *MNEMONIC*
 * - Forbidden imports (Solana web3 signing, Jito clients, etc.)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..', '..', '..');
const ROOT = __dirname;

interface Violation {
  file: string;
  line: number;
  pattern: string;
  reason: string;
}

const violations: Violation[] = [];

/**
 * Forbidden patterns that indicate live trading code
 */
const FORBIDDEN_PATTERNS = [
  {
    pattern: /Keypair\.fromSecretKey/,
    reason: 'Keypair.fromSecretKey - Loading private keys is forbidden',
  },
  {
    pattern: /\.fromSecretKey\(/,
    reason: 'fromSecretKey() - Loading private keys is forbidden',
  },
  {
    pattern: /sendTransaction\s*\(/,
    reason: 'sendTransaction() - Submitting transactions is forbidden',
  },
  {
    pattern: /sendRawTransaction\s*\(/,
    reason: 'sendRawTransaction() - Submitting raw transactions is forbidden',
  },
  {
    pattern: /signTransaction\s*\(/,
    reason: 'signTransaction() - Signing transactions is forbidden',
  },
  {
    pattern: /signAllTransactions\s*\(/,
    reason: 'signAllTransactions() - Signing multiple transactions is forbidden',
  },
  {
    pattern: /process\.env\.[A-Z_]*PRIVATE[A-Z_]*/,
    reason: 'process.env.*PRIVATE* - Private keys in environment variables are forbidden',
  },
  {
    pattern: /process\.env\.[A-Z_]*SECRET[A-Z_]*/,
    reason: 'process.env.*SECRET* - Secrets in environment variables are forbidden',
  },
  {
    pattern: /process\.env\.[A-Z_]*MNEMONIC[A-Z_]*/,
    reason: 'process.env.*MNEMONIC* - Mnemonics in environment variables are forbidden',
  },
];

/**
 * Forbidden imports that indicate live trading libraries
 *
 * Note: We allow PublicKey imports from @solana/web3.js since it's read-only.
 * The pattern matching will check if the import contains only PublicKey.
 */
const FORBIDDEN_IMPORTS = [
  {
    pattern: /from\s+['"]@solana\/web3\.js['"]/,
    reason:
      '@solana/web3.js - Contains signing and transaction submission. Only PublicKey (read-only) is allowed. See docs/BOUNDARIES.md',
    // Allow PublicKey-only imports
    allowPublicKey: true,
  },
  {
    pattern: /from\s+['"]@solana\/spl-token['"]/,
    reason: '@solana/spl-token - May contain signing functions (use read-only alternatives)',
  },
  {
    pattern: /from\s+['"]@jito-foundation\/block-engine-client['"]/,
    reason: '@jito-foundation/block-engine-client - Jito block engine client is for live trading',
  },
  {
    pattern: /from\s+['"]@solana\/wallet-adapter/,
    reason: '@solana/wallet-adapter - Wallet adapters are for live trading',
  },
  {
    pattern: /from\s+['"]@solana\/wallet-adapter-base/,
    reason: '@solana/wallet-adapter-base - Wallet adapters are for live trading',
  },
  {
    pattern: /from\s+['"]@solana\/wallet-adapter-wallets/,
    reason: '@solana/wallet-adapter-wallets - Wallet adapters are for live trading',
  },
];

/**
 * Allowed read-only Solana imports (for data decoding)
 * These are exceptions to the general Solana import ban
 */
const ALLOWED_READONLY_IMPORTS = [
  /@solana\/buffer-layout/, // For decoding data structures
  /@solana\/codecs/, // For encoding/decoding (read-only)
  /@solana\/address/, // For address validation (read-only)
];

/**
 * Recursively find all TypeScript/JavaScript files
 */
function findSourceFiles(
  dir: string,
  excludeDirs: string[] = ['node_modules', 'dist', '.git', 'coverage']
): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip excluded directories
      if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
        files.push(...findSourceFiles(fullPath, excludeDirs));
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read, skip
  }

  return files;
}

/**
 * Check a file for forbidden patterns
 */
function checkFile(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Check for forbidden patterns
  const isTestFile =
    filePath.includes('/tests/') || filePath.includes('.test.') || filePath.includes('.spec.');

  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        // Skip if it's in a comment or string literal (documentation)
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          return;
        }
        // Skip if it's in a string literal (test data, documentation)
        if (line.includes('"') || line.includes("'")) {
          // Check if the pattern is inside quotes (string literal)
          const inString =
            /["'].*process\.env\.[A-Z_]*SECRET.*["']/.test(line) ||
            /["'].*Keypair\.fromSecretKey.*["']/.test(line) ||
            /["'].*sendTransaction.*["']/.test(line);
          if (inString) {
            return; // It's in a string literal, not actual code
          }
        }
        // Skip process.env.*SECRET* checks in test files (they often test security)
        if (isTestFile && pattern.toString().includes('SECRET')) {
          return;
        }
        violations.push({
          file: filePath.replace(ROOT + '/', ''),
          line: index + 1,
          pattern: pattern.toString(),
          reason,
        });
      }
    });
  }

  // Check for forbidden imports
  for (const forbiddenImport of FORBIDDEN_IMPORTS) {
    const { pattern, reason, allowPublicKey } = forbiddenImport;
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        // Skip if it's in a comment
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
          return;
        }

        // Check if it's an allowed read-only import
        const isAllowed = ALLOWED_READONLY_IMPORTS.some((allowed) => allowed.test(line));
        if (isAllowed) {
          return;
        }

        // Allow @solana/web3.js imports that only use PublicKey (read-only)
        // PublicKey is read-only and used for address validation/decoding
        if (line.includes('@solana/web3.js')) {
          const trimmedLine = line.trim();
          // Check if the import only uses PublicKey (read-only)
          // Match: import { PublicKey } from '@solana/web3.js'
          const publicKeyOnlyPattern =
            /import\s+(?:type\s+)?{\s*PublicKey\s*}\s+from\s+['"]@solana\/web3\.js['"]/;
          if (publicKeyOnlyPattern.test(trimmedLine)) {
            return; // Allow PublicKey-only imports (read-only)
          }
        }

        violations.push({
          file: filePath.replace(ROOT + '/', ''),
          line: index + 1,
          pattern: pattern.toString(),
          reason,
        });
      }
    });
  }
}

/**
 * Main check function
 */
function main(): void {
  console.log('🔍 Checking for live trading code patterns...\n');

  // Find all source files
  const packagesDir = join(ROOT, 'packages');
  const scriptsDir = join(ROOT, 'scripts');
  const checkScriptPath = __filename; // Exclude this script from checking

  const sourceFiles: string[] = [];

  // Check packages
  try {
    const packagesStat = statSync(packagesDir);
    if (packagesStat.isDirectory()) {
      const packageFiles = findSourceFiles(packagesDir);
      sourceFiles.push(...packageFiles);
    }
  } catch (error) {
    console.warn(`⚠️  Warning: Could not read packages directory: ${error}\n`);
  }

  // Check scripts (optional - scripts may contain legacy code)
  try {
    const scriptsStat = statSync(scriptsDir);
    if (scriptsStat.isDirectory()) {
      const scriptFiles = findSourceFiles(scriptsDir);
      sourceFiles.push(...scriptFiles);
    }
  } catch (error) {
    // Scripts directory is optional, skip silently
  }

  console.log(`📁 Scanning ${sourceFiles.length} source files...\n`);

  // Check each file (exclude this check script itself)
  for (const file of sourceFiles) {
    if (file !== checkScriptPath) {
      checkFile(file);
    }
  }

  // Report violations
  if (violations.length > 0) {
    console.error('❌ Found live trading code violations:\n');
    violations.forEach((violation) => {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    Pattern: ${violation.pattern}`);
      console.error(`    Reason: ${violation.reason}\n`);
    });

    console.error(
      `\n💥 Build failed: Found ${violations.length} violation(s) of the "simulation lab only" policy.\n`
    );
    console.error(
      'QuantBot is a simulation lab only. Live trading code (signing, submission, key loading) is forbidden.\n'
    );
    console.error('See docs/BOUNDARIES.md for details.\n');
    process.exit(1);
  }

  console.log('✅ No live trading code patterns detected.\n');
  console.log('✅ QuantBot remains a simulation lab only.\n');
}

main();
