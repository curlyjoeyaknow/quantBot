/**
 * Form Component - Input forms with validation
 */

// @ts-expect-error - prompts doesn't have TypeScript declarations
import prompts from 'prompts';

/**
 * Form field definition
 */
export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  required?: boolean;
  options?: Array<{ title: string; value: string }>;
  validate?: (value: unknown) => boolean | string;
}

/**
 * Form result
 */
export interface FormResult {
  [key: string]: unknown;
}

/**
 * Show a form and collect input
 */
export async function showForm(fields: FormField[]): Promise<FormResult> {
  const questions = fields.map((field) => {
    const base = {
      name: field.name,
      message: field.label,
      type: field.type === 'select' ? 'select' : field.type === 'number' ? 'number' : 'text',
      required: field.required ?? false,
    };

    if (field.type === 'select' && field.options) {
      return {
        ...base,
        choices: field.options,
      };
    }

    if (field.validate) {
      return {
        ...base,
        validate: field.validate,
      };
    }

    return base;
  });

  const result = await prompts(questions);
  return result as FormResult;
}
