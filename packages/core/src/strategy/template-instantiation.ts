/**
 * Template Instantiation
 *
 * Converts a strategy template with parameter placeholders into a concrete
 * StrategyDSL by replacing placeholders with actual parameter values.
 */

import type { StrategyDSL } from './dsl-schema.js';
import type { StrategyTemplate, TemplateParameters } from './template-schema.js';
import {
  validateTemplateParameters,
  replacePlaceholders,
  extractPlaceholders,
} from './template-schema.js';
import { validateFull } from './dsl-validator.js';

/**
 * Instantiate a strategy template with parameter values
 *
 * @param template - The strategy template to instantiate
 * @param parameters - Parameter values to replace placeholders
 * @returns A concrete StrategyDSL instance
 * @throws Error if parameters are invalid or instantiation fails
 */
export function instantiateTemplate(
  template: StrategyTemplate,
  parameters: TemplateParameters = {}
): StrategyDSL {
  // Apply default parameter values
  const finalParameters: TemplateParameters = { ...parameters };
  for (const param of template.parameters) {
    if (!(param.name in finalParameters) && param.default !== undefined) {
      finalParameters[param.name] = param.default;
    }
  }

  // Validate parameters
  const validation = validateTemplateParameters(template, finalParameters);
  if (!validation.valid) {
    throw new Error(`Invalid template parameters: ${validation.errors.join(', ')}`);
  }

  // Check all placeholders have values
  const placeholders = extractPlaceholders(template.template);
  for (const placeholder of placeholders) {
    if (!(placeholder in finalParameters)) {
      throw new Error(`Missing parameter value for placeholder: ${placeholder}`);
    }
  }

  // Replace placeholders in template
  const instantiated = replacePlaceholders(template.template, finalParameters) as StrategyDSL;

  // Validate the instantiated DSL
  const dslValidation = validateFull(instantiated);
  if (!dslValidation.schemaValid) {
    const errors = dslValidation.schemaErrors.map((e: string) => e);
    throw new Error(`Instantiated DSL is invalid: ${errors.join(', ')}`);
  }

  return instantiated;
}

/**
 * List all parameter placeholders in a template
 *
 * @param template - The strategy template
 * @returns Set of parameter names referenced in the template
 */
export function listTemplateParameters(template: StrategyTemplate): Set<string> {
  return extractPlaceholders(template.template);
}

/**
 * Get default parameters for a template
 *
 * @param template - The strategy template
 * @returns Default parameter values
 */
export function getDefaultParameters(template: StrategyTemplate): TemplateParameters {
  const defaults: TemplateParameters = {};
  for (const param of template.parameters) {
    if (param.default !== undefined) {
      defaults[param.name] = param.default;
    }
  }
  return defaults;
}
