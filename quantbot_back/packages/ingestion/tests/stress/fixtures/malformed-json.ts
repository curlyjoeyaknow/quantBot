/**
 * Malformed JSON Fixtures
 *
 * Edge cases for Python bridge JSON parsing and validation.
 * Tests that the system fails loudly when Python tools misbehave.
 */

export interface PythonOutputTestCase {
  description: string;
  stdout: string;
  stderr?: string;
  exitCode: number;
  expectedError: 'parse_error' | 'validation_error' | 'timeout' | 'process_error';
  category: 'malformed' | 'wrong_schema' | 'missing_fields' | 'extra_fields' | 'process_failure';
}

/**
 * Malformed JSON outputs
 */
export const MALFORMED_JSON_CASES: PythonOutputTestCase[] = [
  {
    description: 'Not JSON at all',
    stdout: 'This is just plain text output',
    exitCode: 0,
    expectedError: 'parse_error',
    category: 'malformed',
  },
  {
    description: 'Partial JSON (truncated)',
    stdout: '{"chat_id": "test", "chat_name": "Test Chat", "duckdb_file":',
    exitCode: 0,
    expectedError: 'parse_error',
    category: 'malformed',
  },
  {
    description: 'Invalid JSON syntax (trailing comma)',
    stdout: '{"chat_id": "test", "chat_name": "Test Chat",}',
    exitCode: 0,
    expectedError: 'parse_error',
    category: 'malformed',
  },
  {
    description: 'Invalid JSON syntax (single quotes)',
    stdout: "{'chat_id': 'test', 'chat_name': 'Test Chat'}",
    exitCode: 0,
    expectedError: 'parse_error',
    category: 'malformed',
  },
  {
    description: 'Empty string',
    stdout: '',
    exitCode: 0,
    expectedError: 'parse_error',
    category: 'malformed',
  },
  {
    description: 'Only whitespace',
    stdout: '   \n\t  \n  ',
    exitCode: 0,
    expectedError: 'parse_error',
    category: 'malformed',
  },
  {
    description: 'Multiple JSON objects (not array)',
    stdout: '{"a": 1}\n{"b": 2}',
    exitCode: 0,
    expectedError: 'parse_error',
    category: 'malformed',
  },
];

/**
 * Valid JSON but wrong schema
 */
export const WRONG_SCHEMA_CASES: PythonOutputTestCase[] = [
  {
    description: 'Wrong field types (string instead of number)',
    stdout: JSON.stringify({
      chat_id: 'test',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/db',
      tg_rows: 'not a number',
    }),
    exitCode: 0,
    expectedError: 'validation_error',
    category: 'wrong_schema',
  },
  {
    description: 'Wrong field types (number instead of string)',
    stdout: JSON.stringify({
      chat_id: 12345,
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/db',
    }),
    exitCode: 0,
    expectedError: 'validation_error',
    category: 'wrong_schema',
  },
  {
    description: 'Array instead of object',
    stdout: JSON.stringify(['chat_id', 'chat_name', 'duckdb_file']),
    exitCode: 0,
    expectedError: 'validation_error',
    category: 'wrong_schema',
  },
  {
    description: 'Null instead of object',
    stdout: 'null',
    exitCode: 0,
    expectedError: 'validation_error',
    category: 'wrong_schema',
  },
  {
    description: 'Boolean instead of object',
    stdout: 'true',
    exitCode: 0,
    expectedError: 'validation_error',
    category: 'wrong_schema',
  },
];

/**
 * Missing required fields
 */
export const MISSING_FIELDS_CASES: PythonOutputTestCase[] = [
  {
    description: 'Missing chat_id',
    stdout: JSON.stringify({
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/db',
    }),
    exitCode: 0,
    expectedError: 'validation_error',
    category: 'missing_fields',
  },
  {
    description: 'Missing chat_name',
    stdout: JSON.stringify({
      chat_id: 'test',
      duckdb_file: '/path/to/db',
    }),
    exitCode: 0,
    expectedError: 'validation_error',
    category: 'missing_fields',
  },
  {
    description: 'Missing duckdb_file',
    stdout: JSON.stringify({
      chat_id: 'test',
      chat_name: 'Test Chat',
    }),
    exitCode: 0,
    expectedError: 'validation_error',
    category: 'missing_fields',
  },
  {
    description: 'Empty object',
    stdout: '{}',
    exitCode: 0,
    expectedError: 'validation_error',
    category: 'missing_fields',
  },
];

/**
 * Extra fields (should be okay with passthrough, but test it)
 */
export const EXTRA_FIELDS_CASES: PythonOutputTestCase[] = [
  {
    description: 'Extra fields (should pass with passthrough)',
    stdout: JSON.stringify({
      chat_id: 'test',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/db',
      extra_field: 'unexpected',
      another_extra: 123,
    }),
    exitCode: 0,
    expectedError: 'validation_error', // Will be 'none' if passthrough works
    category: 'extra_fields',
  },
];

/**
 * Process failures
 */
export const PROCESS_FAILURE_CASES: PythonOutputTestCase[] = [
  {
    description: 'Nonzero exit code with error message',
    stdout: '',
    stderr:
      'Traceback (most recent call last):\n  File "script.py", line 10\n    SyntaxError: invalid syntax',
    exitCode: 1,
    expectedError: 'process_error',
    category: 'process_failure',
  },
  {
    description: 'Nonzero exit code with JSON error',
    stdout: JSON.stringify({ error: 'Database connection failed' }),
    stderr: '',
    exitCode: 1,
    expectedError: 'process_error',
    category: 'process_failure',
  },
  {
    description: 'Exit code 2 (usage error)',
    stdout: 'usage: script.py [-h] --input INPUT',
    stderr: 'error: the following arguments are required: --input',
    exitCode: 2,
    expectedError: 'process_error',
    category: 'process_failure',
  },
  {
    description: 'Killed by signal (SIGTERM)',
    stdout: '',
    stderr: '',
    exitCode: 143, // 128 + 15 (SIGTERM)
    expectedError: 'process_error',
    category: 'process_failure',
  },
];

/**
 * Logs contaminating stdout (should go to stderr)
 */
export const STDOUT_CONTAMINATION_CASES: PythonOutputTestCase[] = [
  {
    description: 'Debug logs before JSON',
    stdout:
      'DEBUG: Loading data...\nDEBUG: Processing...\n{"chat_id": "test", "chat_name": "Test Chat", "duckdb_file": "/path/to/db"}',
    exitCode: 0,
    expectedError: 'parse_error', // Last line should be JSON
    category: 'malformed',
  },
  {
    description: 'Print statements mixed with JSON',
    stdout:
      'Starting process\n{"chat_id": "test", "chat_name": "Test Chat", "duckdb_file": "/path/to/db"}\nDone!',
    exitCode: 0,
    expectedError: 'parse_error', // Last line is not JSON
    category: 'malformed',
  },
  {
    description: 'Progress indicators',
    stdout:
      'Processing: 10%\nProcessing: 50%\nProcessing: 100%\n{"chat_id": "test", "chat_name": "Test Chat", "duckdb_file": "/path/to/db"}',
    exitCode: 0,
    expectedError: 'parse_error', // Only last line should be JSON
    category: 'malformed',
  },
];

/**
 * Huge outputs (resource exhaustion)
 */
export const HUGE_OUTPUT_CASES: PythonOutputTestCase[] = [
  {
    description: 'Extremely large JSON (>10MB)',
    stdout: JSON.stringify({
      chat_id: 'test',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/db',
      huge_data: 'x'.repeat(11 * 1024 * 1024), // 11MB of 'x'
    }),
    exitCode: 0,
    expectedError: 'process_error', // Should exceed maxBuffer
    category: 'process_failure',
  },
  {
    description: 'Many log lines before JSON',
    stdout:
      Array(100000).fill('LOG: Processing item').join('\n') +
      '\n{"chat_id": "test", "chat_name": "Test Chat", "duckdb_file": "/path/to/db"}',
    exitCode: 0,
    expectedError: 'parse_error', // May succeed if within buffer, but tests large output handling
    category: 'malformed',
  },
];

/**
 * Valid outputs (for comparison)
 */
export const VALID_OUTPUT_CASES = [
  {
    description: 'Minimal valid output',
    stdout: JSON.stringify({
      chat_id: 'test',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/db',
    }),
    exitCode: 0,
  },
  {
    description: 'Full valid output with optional fields',
    stdout: JSON.stringify({
      chat_id: 'test',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/db',
      tg_rows: 100,
      caller_links_rows: 50,
      user_calls_rows: 25,
    }),
    exitCode: 0,
  },
  {
    description: 'Valid output with logs on stderr',
    stdout: JSON.stringify({
      chat_id: 'test',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/db',
    }),
    stderr: 'DEBUG: Loading data...\nINFO: Processing 100 messages\nINFO: Complete',
    exitCode: 0,
  },
];

/**
 * All error cases combined
 */
export const ALL_ERROR_CASES: PythonOutputTestCase[] = [
  ...MALFORMED_JSON_CASES,
  ...WRONG_SCHEMA_CASES,
  ...MISSING_FIELDS_CASES,
  ...PROCESS_FAILURE_CASES,
  ...STDOUT_CONTAMINATION_CASES,
  ...HUGE_OUTPUT_CASES,
];
