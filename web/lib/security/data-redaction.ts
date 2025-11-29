/**
 * Data Redaction Utility
 * ======================
 * Redacts sensitive information from API responses to prevent data exposure.
 */

/**
 * List of key patterns that indicate sensitive data
 * These will be redacted from API responses
 */
const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /api[_-]?token/i,
  /access[_-]?token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /pwd/i,
  /private[_-]?key/i,
  /private[_-]?token/i,
  /auth[_-]?token/i,
  /bearer/i,
  /credential/i,
  /session[_-]?id/i,
  /cookie/i,
  /jwt/i,
  /oauth/i,
  /refresh[_-]?token/i,
  /client[_-]?secret/i,
  /client[_-]?id/i,
  /consumer[_-]?key/i,
  /consumer[_-]?secret/i,
  /aws[_-]?secret/i,
  /aws[_-]?access[_-]?key/i,
  /database[_-]?password/i,
  /db[_-]?password/i,
  /redis[_-]?password/i,
  /mongodb[_-]?password/i,
  /postgres[_-]?password/i,
  /mysql[_-]?password/i,
  /encryption[_-]?key/i,
  /signing[_-]?key/i,
];

/**
 * Default redaction string
 */
const REDACTION_STRING = '***REDACTED***';

/**
 * Checks if a key should be redacted based on sensitive patterns
 * 
 * @param key - The key to check
 * @returns true if the key should be redacted
 */
export function isSensitiveKey(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }

  return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Redacts sensitive values from an object recursively
 * 
 * @param obj - The object to redact
 * @param customPatterns - Additional patterns to check (optional)
 * @returns A new object with sensitive values redacted
 * 
 * @example
 * ```typescript
 * const data = { apiKey: 'secret123', name: 'John' };
 * const redacted = redactSensitiveData(data);
 * // Returns: { apiKey: '***REDACTED***', name: 'John' }
 * ```
 */
export function redactSensitiveData<T extends Record<string, any>>(
  obj: T,
  customPatterns: RegExp[] = []
): T {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, customPatterns)) as unknown as T;
  }

  // Handle null
  if (obj === null) {
    return obj;
  }

  // Create a new object to avoid mutating the original
  const redacted: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Check if key should be redacted
    const shouldRedact = isSensitiveKey(key) || 
      customPatterns.some(pattern => pattern.test(key));

    if (shouldRedact) {
      // Redact the value
      redacted[key] = REDACTION_STRING;
    } else if (value && typeof value === 'object') {
      // Recursively redact nested objects
      redacted[key] = redactSensitiveData(value, customPatterns);
    } else {
      // Keep the value as-is
      redacted[key] = value;
    }
  }

  return redacted as T;
}

/**
 * Redacts sensitive values from an array of objects
 * 
 * @param arr - The array to redact
 * @param customPatterns - Additional patterns to check (optional)
 * @returns A new array with sensitive values redacted
 */
export function redactSensitiveDataArray<T extends Record<string, any>>(
  arr: T[],
  customPatterns: RegExp[] = []
): T[] {
  if (!Array.isArray(arr)) {
    return arr;
  }

  return arr.map(item => redactSensitiveData(item, customPatterns));
}

/**
 * Redacts a specific key from an object
 * 
 * @param obj - The object
 * @param key - The key to redact
 * @returns A new object with the specified key redacted
 */
export function redactKey<T extends Record<string, any>>(
  obj: T,
  key: string
): T {
  if (!obj || typeof obj !== 'object' || !(key in obj)) {
    return obj;
  }

  return {
    ...obj,
    [key]: REDACTION_STRING,
  };
}

/**
 * Redacts multiple keys from an object
 * 
 * @param obj - The object
 * @param keys - The keys to redact
 * @returns A new object with the specified keys redacted
 */
export function redactKeys<T extends Record<string, any>>(
  obj: T,
  keys: string[]
): T {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const redacted: any = { ...obj };
  for (const key of keys) {
    if (key in redacted) {
      redacted[key] = REDACTION_STRING;
    }
  }

  return redacted as T;
}

/**
 * Gets a list of all sensitive keys in an object
 * 
 * @param obj - The object to scan
 * @returns Array of sensitive key names
 */
export function findSensitiveKeys(obj: Record<string, any>): string[] {
  if (!obj || typeof obj !== 'object') {
    return [];
  }

  const sensitiveKeys: string[] = [];

  for (const key of Object.keys(obj)) {
    if (isSensitiveKey(key)) {
      sensitiveKeys.push(key);
    } else if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      // Recursively check nested objects
      const nestedKeys = findSensitiveKeys(obj[key]);
      sensitiveKeys.push(...nestedKeys.map(nk => `${key}.${nk}`));
    }
  }

  return sensitiveKeys;
}

