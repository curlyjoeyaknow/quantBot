/**
 * Strategy Template Schema
 *
 * Templates allow creating parameterized strategy DSLs that can be instantiated
 * with specific parameter values. Templates define:
 * - Parameter placeholders with types, defaults, and constraints
 * - Base DSL structure with placeholders
 * - Metadata (name, description, category)
 */

import { z } from 'zod';
import type { StrategyDSL } from './dsl-schema.js';

/**
 * Parameter type definitions for templates
 */
export const ParameterTypeSchema = z.enum(['number', 'string', 'boolean', 'choice']);

export type ParameterType = z.infer<typeof ParameterTypeSchema>;

/**
 * Parameter constraint schema
 */
export const ParameterConstraintSchema = z.object({
  /** Minimum value (for number type) */
  min: z.number().optional(),
  /** Maximum value (for number type) */
  max: z.number().optional(),
  /** Step size for number parameters */
  step: z.number().optional(),
  /** Allowed choices (for choice type) */
  choices: z.array(z.union([z.string(), z.number()])).optional(),
  /** Custom validation function name (optional) */
  validator: z.string().optional(),
});

export type ParameterConstraint = z.infer<typeof ParameterConstraintSchema>;

/**
 * Template parameter definition
 */
export const TemplateParameterSchema = z.object({
  /** Parameter name (must be valid identifier) */
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid parameter name'),
  /** Parameter type */
  type: ParameterTypeSchema,
  /** Default value (must match type) */
  default: z.union([z.number(), z.string(), z.boolean()]).optional(),
  /** Parameter description */
  description: z.string().optional(),
  /** Constraints/validation rules */
  constraints: ParameterConstraintSchema.optional(),
  /** Whether parameter is required */
  required: z.boolean().default(false),
});

export type TemplateParameter = z.infer<typeof TemplateParameterSchema>;

/**
 * Template placeholder schema
 *
 * Placeholders in templates use the syntax: ${param_name}
 * They are replaced with actual values during instantiation.
 */
export const TemplatePlaceholderSchema = z.string().regex(/^\$\{[a-zA-Z_][a-zA-Z0-9_]*\}$/);

export type TemplatePlaceholder = z.infer<typeof TemplatePlaceholderSchema>;

/**
 * Strategy Template Schema
 *
 * A template is a StrategyDSL with parameter placeholders.
 * The structure is the same as StrategyDSL, but values can contain
 * placeholders like ${param_name}.
 */
export const StrategyTemplateSchema = z.object({
  /** Template version */
  version: z.string().default('1.0.0'),
  /** Template name (unique identifier) */
  name: z.string().min(1),
  /** Template description */
  description: z.string().optional(),
  /** Template category/tags */
  tags: z.array(z.string()).default([]),
  /** Template parameters */
  parameters: z.array(TemplateParameterSchema).default([]),
  /** Template DSL structure (with placeholders) */
  template: z.record(z.string(), z.unknown()), // StrategyDSL structure with string placeholders (flexible)
  /** Template metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Strategy Template
 *
 * A template defines a parameterized strategy that can be instantiated
 * with specific parameter values.
 */
export type StrategyTemplate = z.infer<typeof StrategyTemplateSchema>;

/**
 * Template instantiation parameters
 *
 * Maps parameter names to their values for instantiation.
 */
export const TemplateParametersSchema = z.record(
  z.string(),
  z.union([z.number(), z.string(), z.boolean()])
);

export type TemplateParameters = z.infer<typeof TemplateParametersSchema>;

/**
 * Extract placeholder names from a value
 *
 * Finds all ${param_name} placeholders in a string or nested object.
 */
export function extractPlaceholders(value: unknown): Set<string> {
  const placeholders = new Set<string>();

  function traverse(obj: unknown): void {
    if (typeof obj === 'string') {
      const matches = obj.match(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
      if (matches) {
        for (const match of matches) {
          const paramName = match.slice(2, -1); // Remove ${ and }
          placeholders.add(paramName);
        }
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        traverse(item);
      }
    } else if (obj !== null && typeof obj === 'object') {
      for (const value of Object.values(obj)) {
        traverse(value);
      }
    }
  }

  traverse(value);
  return placeholders;
}

/**
 * Replace placeholders in a value with parameter values
 *
 * Recursively replaces ${param_name} placeholders with actual values.
 */
export function replacePlaceholders(value: unknown, parameters: TemplateParameters): unknown {
  if (typeof value === 'string') {
    let result = value;
    for (const [paramName, paramValue] of Object.entries(parameters)) {
      const placeholder = `\${${paramName}}`;
      result = result.replace(new RegExp(`\\$\\{${paramName}\\}`, 'g'), String(paramValue));
    }
    return result;
  } else if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, parameters));
  } else if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = replacePlaceholders(val, parameters);
    }
    return result;
  }
  return value;
}

/**
 * Validate template parameters against template definition
 */
export function validateTemplateParameters(
  template: StrategyTemplate,
  parameters: TemplateParameters
): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check all required parameters are provided
  for (const param of template.parameters) {
    if (param.required && !(param.name in parameters)) {
      errors.push(`Missing required parameter: ${param.name}`);
    }
  }

  // Check parameter types and constraints
  for (const [paramName, paramValue] of Object.entries(parameters)) {
    const paramDef = template.parameters.find((p: { name: string }) => p.name === paramName);
    if (!paramDef) {
      errors.push(`Unknown parameter: ${paramName}`);
      continue;
    }

    // Type check
    if (paramDef.type === 'number' && typeof paramValue !== 'number') {
      errors.push(`Parameter ${paramName} must be a number, got ${typeof paramValue}`);
    } else if (paramDef.type === 'string' && typeof paramValue !== 'string') {
      errors.push(`Parameter ${paramName} must be a string, got ${typeof paramValue}`);
    } else if (paramDef.type === 'boolean' && typeof paramValue !== 'boolean') {
      errors.push(`Parameter ${paramName} must be a boolean, got ${typeof paramValue}`);
    }

    // Constraint check
    if (paramDef.constraints) {
      if (paramDef.type === 'number' && typeof paramValue === 'number') {
        if (paramDef.constraints.min !== undefined && paramValue < paramDef.constraints.min) {
          errors.push(
            `Parameter ${paramName} must be >= ${paramDef.constraints.min}, got ${paramValue}`
          );
        }
        if (paramDef.constraints.max !== undefined && paramValue > paramDef.constraints.max) {
          errors.push(
            `Parameter ${paramName} must be <= ${paramDef.constraints.max}, got ${paramValue}`
          );
        }
      } else if (paramDef.type === 'choice' && paramDef.constraints.choices) {
        // Check if paramValue matches any choice (type-safe comparison)
        const valueStr = String(paramValue);
        const choicesStr = paramDef.constraints.choices.map((c: unknown) => String(c));
        if (!choicesStr.includes(valueStr)) {
          errors.push(
            `Parameter ${paramName} must be one of ${choicesStr.join(', ')}, got ${paramValue}`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
