#!/usr/bin/env tsx
/**
 * Generate Python Type Stubs from Zod Schemas
 *
 * This script converts Zod schemas to Python TypedDict definitions (.pyi files).
 * Ensures type consistency between TypeScript and Python codebases.
 *
 * Usage:
 *   pnpm run generate-python-stubs
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { z } from 'zod';

// Import schemas from packages
import {
  BaselineBacktestConfigSchema,
  TokenResultSchema,
  BaselineBacktestResultSchema,
} from '../packages/backtest/src/services/baseline-backtest-service.js';

import {
  TokenSliceExportConfigSchema,
  BatchSliceExportConfigSchema,
  SliceExportResultSchema,
  BatchSliceExportResultSchema,
} from '../packages/backtest/src/services/token-slicer-service.js';

import {
  CallerAnalysisConfigSchema,
  CallerStatsSchema,
  CallerScoringSchema,
  CallerAnalysisResultSchema,
} from '../packages/backtest/src/services/caller-analysis-service.js';

// =============================================================================
// Type Mapping: JSON Schema → Python Types
// =============================================================================

interface PythonType {
  type: string;
  imports: Set<string>;
}

function jsonSchemaToPythonType(schema: any, name?: string): PythonType {
  const imports = new Set<string>();

  function convertType(s: any): string {
    // Handle references
    if (s.$ref) {
      const refName = s.$ref.split('/').pop();
      return refName || 'Any';
    }

    // Handle nullable/optional
    if (s.anyOf) {
      const types = s.anyOf.map((t: any) => convertType(t));
      if (types.includes('None')) {
        imports.add('from typing import Optional');
        const nonNoneTypes = types.filter((t: string) => t !== 'None');
        return `Optional[${nonNoneTypes.join(' | ')}]`;
      }
      imports.add('from typing import Union');
      return `Union[${types.join(', ')}]`;
    }

    // Handle arrays
    if (s.type === 'array') {
      imports.add('from typing import List');
      const itemType = s.items ? convertType(s.items) : 'Any';
      return `List[${itemType}]`;
    }

    // Handle objects
    if (s.type === 'object') {
      if (name) {
        return name;
      }
      imports.add('from typing import Dict, Any');
      return 'Dict[str, Any]';
    }

    // Handle enums
    if (s.enum) {
      imports.add('from typing import Literal');
      const values = s.enum.map((v: any) => `"${v}"`).join(', ');
      return `Literal[${values}]`;
    }

    // Handle primitives
    switch (s.type) {
      case 'string':
        return 'str';
      case 'number':
        return 'float';
      case 'integer':
        return 'int';
      case 'boolean':
        return 'bool';
      case 'null':
        return 'None';
      default:
        imports.add('from typing import Any');
        return 'Any';
    }
  }

  const pythonType = convertType(schema);
  return { type: pythonType, imports };
}

// =============================================================================
// Generate TypedDict from JSON Schema
// =============================================================================

function generateTypedDict(name: string, schema: any): string {
  const lines: string[] = [];
  const imports = new Set<string>(['from typing import TypedDict']);

  // Convert schema
  const jsonSchema = schema;

  if (jsonSchema.type !== 'object' || !jsonSchema.properties) {
    console.warn(`Schema ${name} is not an object, skipping`);
    return '';
  }

  // Collect all imports
  const fields: Array<{ name: string; type: string; optional: boolean }> = [];

  for (const [key, value] of Object.entries(jsonSchema.properties as Record<string, any>)) {
    const { type, imports: fieldImports } = jsonSchemaToPythonType(value, undefined);
    fieldImports.forEach((imp) => imports.add(imp));

    const isOptional = !jsonSchema.required?.includes(key);
    const pythonKey = key === 'from' ? 'from_' : key; // Handle Python keywords

    fields.push({
      name: pythonKey,
      type,
      optional: isOptional,
    });
  }

  // Generate imports
  lines.push('"""Auto-generated Python type stubs from Zod schemas."""');
  lines.push('');
  Array.from(imports)
    .sort()
    .forEach((imp) => lines.push(imp));
  lines.push('');

  // Generate TypedDict
  lines.push('');
  lines.push(`class ${name}(TypedDict${fields.some((f) => f.optional) ? ', total=False' : ''}):`);
  lines.push('    """');
  lines.push(`    ${name} type definition.`);
  lines.push('    Auto-generated from Zod schema.');
  lines.push('    """');

  if (fields.length === 0) {
    lines.push('    pass');
  } else {
    // Required fields first
    const requiredFields = fields.filter((f) => !f.optional);
    const optionalFields = fields.filter((f) => f.optional);

    if (requiredFields.length > 0 && optionalFields.length > 0) {
      lines.push('    # Required fields');
    }
    requiredFields.forEach(({ name, type }) => {
      lines.push(`    ${name}: ${type}`);
    });

    if (optionalFields.length > 0) {
      if (requiredFields.length > 0) {
        lines.push('');
        lines.push('    # Optional fields');
      }
      optionalFields.forEach(({ name, type }) => {
        lines.push(`    ${name}: ${type}`);
      });
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Schema Definitions
// =============================================================================

interface SchemaDefinition {
  name: string;
  schema: z.ZodSchema<any>;
  outputPath: string;
}

const schemas: SchemaDefinition[] = [
  // Baseline Backtest
  {
    name: 'BaselineBacktestConfig',
    schema: BaselineBacktestConfigSchema,
    outputPath: 'packages/backtest/python/types/baseline_backtest.pyi',
  },
  {
    name: 'TokenResult',
    schema: TokenResultSchema,
    outputPath: 'packages/backtest/python/types/baseline_backtest.pyi',
  },
  {
    name: 'BaselineBacktestResult',
    schema: BaselineBacktestResultSchema,
    outputPath: 'packages/backtest/python/types/baseline_backtest.pyi',
  },

  // Token Slicer
  {
    name: 'TokenSliceExportConfig',
    schema: TokenSliceExportConfigSchema,
    outputPath: 'packages/backtest/python/types/token_slicer.pyi',
  },
  {
    name: 'BatchSliceExportConfig',
    schema: BatchSliceExportConfigSchema,
    outputPath: 'packages/backtest/python/types/token_slicer.pyi',
  },
  {
    name: 'SliceExportResult',
    schema: SliceExportResultSchema,
    outputPath: 'packages/backtest/python/types/token_slicer.pyi',
  },
  {
    name: 'BatchSliceExportResult',
    schema: BatchSliceExportResultSchema,
    outputPath: 'packages/backtest/python/types/token_slicer.pyi',
  },

  // Caller Analysis
  {
    name: 'CallerAnalysisConfig',
    schema: CallerAnalysisConfigSchema,
    outputPath: 'packages/backtest/python/types/caller_analysis.pyi',
  },
  {
    name: 'CallerStats',
    schema: CallerStatsSchema,
    outputPath: 'packages/backtest/python/types/caller_analysis.pyi',
  },
  {
    name: 'CallerScoring',
    schema: CallerScoringSchema,
    outputPath: 'packages/backtest/python/types/caller_analysis.pyi',
  },
  {
    name: 'CallerAnalysisResult',
    schema: CallerAnalysisResultSchema,
    outputPath: 'packages/backtest/python/types/caller_analysis.pyi',
  },
];

// =============================================================================
// Main
// =============================================================================

function main() {
  console.log('🔧 Generating Python type stubs from Zod schemas...\n');

  // Group schemas by output file
  const fileGroups = new Map<string, SchemaDefinition[]>();
  for (const schemaDef of schemas) {
    const existing = fileGroups.get(schemaDef.outputPath) || [];
    existing.push(schemaDef);
    fileGroups.set(schemaDef.outputPath, existing);
  }

  let totalGenerated = 0;

  for (const [outputPath, defs] of fileGroups) {
    console.log(`📝 Generating ${outputPath}...`);

    const allStubs: string[] = [];

    for (const def of defs) {
      try {
        const jsonSchema = zodToJsonSchema(def.schema, def.name);
        const stub = generateTypedDict(def.name, jsonSchema);

        if (stub) {
          allStubs.push(stub);
          console.log(`   ✅ ${def.name}`);
          totalGenerated++;
        }
      } catch (error) {
        console.error(`   ❌ ${def.name}: ${error}`);
      }
    }

    // Write to file
    const fullPath = join(process.cwd(), outputPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, allStubs.join('\n\n') + '\n');
  }

  console.log(`\n✨ Generated ${totalGenerated} type stubs in ${fileGroups.size} files`);
  console.log('\n💡 Usage in Python:');
  console.log('   from packages.backtest.python.types.baseline_backtest import BaselineBacktestConfig');
  console.log('   \n   def run_baseline(config: BaselineBacktestConfig) -> BaselineBacktestResult:');
  console.log('       ...');
}

main();

