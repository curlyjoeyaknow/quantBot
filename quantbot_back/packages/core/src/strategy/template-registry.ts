/**
 * Strategy Template Registry
 *
 * Central registry for strategy templates. Templates are stored as versioned
 * artifacts and can be loaded from files or registered programmatically.
 */

import type { StrategyTemplate } from './template-schema.js';
import { StrategyTemplateSchema } from './template-schema.js';
import { z } from 'zod';

/**
 * Template registry
 *
 * Maps template names to their definitions.
 */
const templateRegistry = new Map<string, StrategyTemplate>();

/**
 * Register a strategy template
 *
 * @param template - The template to register
 * @throws Error if template is invalid or name already exists
 */
export function registerTemplate(template: StrategyTemplate): void {
  // Validate template
  const validation = StrategyTemplateSchema.safeParse(template);
  if (!validation.success) {
    throw new Error(
      `Invalid template: ${validation.error.issues.map((e: z.ZodIssue) => e.message).join(', ')}`
    );
  }

  // Check for duplicate name
  if (templateRegistry.has(template.name)) {
    throw new Error(`Template with name '${template.name}' already exists`);
  }

  templateRegistry.set(template.name, template);
}

/**
 * Get a template by name
 *
 * @param name - Template name
 * @returns The template, or undefined if not found
 */
export function getTemplate(name: string): StrategyTemplate | undefined {
  return templateRegistry.get(name);
}

/**
 * List all registered template names
 *
 * @returns Array of template names
 */
export function listTemplates(): string[] {
  return Array.from(templateRegistry.keys());
}

/**
 * List templates by tag/category
 *
 * @param tag - Tag to filter by
 * @returns Array of template names matching the tag
 */
export function listTemplatesByTag(tag: string): string[] {
  const matching: string[] = [];
  for (const [name, template] of templateRegistry.entries()) {
    if (template.tags.includes(tag)) {
      matching.push(name);
    }
  }
  return matching;
}

/**
 * Remove a template from the registry
 *
 * @param name - Template name to remove
 * @returns true if template was removed, false if not found
 */
export function unregisterTemplate(name: string): boolean {
  return templateRegistry.delete(name);
}

/**
 * Clear all templates from the registry
 */
export function clearTemplates(): void {
  templateRegistry.clear();
}

/**
 * Get all templates
 *
 * @returns Map of all registered templates
 */
export function getAllTemplates(): Map<string, StrategyTemplate> {
  return new Map(templateRegistry);
}

/**
 * Load templates from JSON files
 *
 * This is a helper function that can be used to load templates from
 * the filesystem. Actual loading logic should be in CLI/workflow code.
 *
 * @param templates - Array of template objects (parsed from JSON)
 */
export function loadTemplates(templates: unknown[]): void {
  for (const templateData of templates) {
    const validation = StrategyTemplateSchema.safeParse(templateData);
    if (!validation.success) {
      console.warn(
        `Skipping invalid template: ${validation.error.issues.map((e: z.ZodIssue) => e.message).join(', ')}`
      );
      continue;
    }
    registerTemplate(validation.data);
  }
}
