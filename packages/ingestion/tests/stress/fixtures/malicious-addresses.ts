/**
 * Malicious Address Fixtures
 *
 * Edge cases for address extraction and validation.
 * Each fixture includes the input, expected behavior, and reasoning.
 */

export interface AddressTestCase {
  description: string;
  input: string;
  expectedValid: boolean;
  expectedChain?: 'solana' | 'ethereum' | 'base' | 'bsc';
  expectedRejectionReason?: string;
  category:
    | 'punctuation'
    | 'invisible'
    | 'linebreak'
    | 'markdown'
    | 'url'
    | 'noise'
    | 'obfuscation'
    | 'validation';
}

/**
 * Valid Solana address for reference
 */
export const VALID_SOLANA = 'So11111111111111111111111111111111111111112';

/**
 * Valid EVM address for reference
 */
export const VALID_EVM = '0x1234567890123456789012345678901234567890';

/**
 * Punctuation-wrapped candidates
 */
export const PUNCTUATION_CASES: AddressTestCase[] = [
  {
    description: 'Address wrapped in parentheses',
    input: `(${VALID_SOLANA})`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'punctuation',
  },
  {
    description: 'Address with trailing comma',
    input: `${VALID_SOLANA},`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'punctuation',
  },
  {
    description: 'Address with trailing period',
    input: `${VALID_SOLANA}.`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'punctuation',
  },
  {
    description: 'Address with trailing bracket',
    input: `${VALID_SOLANA}]`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'punctuation',
  },
  {
    description: 'Address in quotes',
    input: `"${VALID_SOLANA}"`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'punctuation',
  },
  {
    description: 'EVM address with checksum and punctuation',
    input: `(${VALID_EVM})`,
    expectedValid: true,
    expectedChain: 'ethereum',
    category: 'punctuation',
  },
];

/**
 * Invisible characters
 */
export const INVISIBLE_CASES: AddressTestCase[] = [
  {
    description: 'Zero-width space at start',
    input: `\u200B${VALID_SOLANA}`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'invisible',
  },
  {
    description: 'Zero-width space at end',
    input: `${VALID_SOLANA}\u200B`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'invisible',
  },
  {
    description: 'Non-breaking space',
    input: `\u00A0${VALID_SOLANA}\u00A0`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'invisible',
  },
  {
    description: 'Zero-width non-joiner',
    input: `${VALID_SOLANA.slice(0, 20)}\u200C${VALID_SOLANA.slice(20)}`,
    expectedValid: false,
    expectedRejectionReason: 'invisible_character',
    category: 'invisible',
  },
  {
    description: 'Soft hyphen',
    input: `${VALID_SOLANA.slice(0, 20)}\u00AD${VALID_SOLANA.slice(20)}`,
    expectedValid: false,
    expectedRejectionReason: 'invisible_character',
    category: 'invisible',
  },
];

/**
 * Line breaks mid-address
 */
export const LINEBREAK_CASES: AddressTestCase[] = [
  {
    description: 'Newline in middle of address',
    input: `${VALID_SOLANA.slice(0, 20)}\n${VALID_SOLANA.slice(20)}`,
    expectedValid: false,
    expectedRejectionReason: 'contains_whitespace',
    category: 'linebreak',
  },
  {
    description: 'Carriage return in address',
    input: `${VALID_SOLANA.slice(0, 20)}\r${VALID_SOLANA.slice(20)}`,
    expectedValid: false,
    expectedRejectionReason: 'contains_whitespace',
    category: 'linebreak',
  },
  {
    description: 'Tab character in address',
    input: `${VALID_SOLANA.slice(0, 20)}\t${VALID_SOLANA.slice(20)}`,
    expectedValid: false,
    expectedRejectionReason: 'contains_whitespace',
    category: 'linebreak',
  },
  {
    description: 'Address split across lines with hyphen',
    input: `${VALID_SOLANA.slice(0, 20)}-\n${VALID_SOLANA.slice(20)}`,
    expectedValid: false,
    expectedRejectionReason: 'invalid_format',
    category: 'linebreak',
  },
];

/**
 * Markdown/code blocks
 */
export const MARKDOWN_CASES: AddressTestCase[] = [
  {
    description: 'Address in inline code',
    input: `\`${VALID_SOLANA}\``,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'markdown',
  },
  {
    description: 'Address in code block',
    input: `\`\`\`\n${VALID_SOLANA}\n\`\`\``,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'markdown',
  },
  {
    description: 'Address with markdown bold',
    input: `**${VALID_SOLANA}**`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'markdown',
  },
  {
    description: 'Address in markdown link',
    input: `[token](https://solscan.io/token/${VALID_SOLANA})`,
    expectedValid: true,
    expectedChain: 'solana',
    category: 'markdown',
  },
];

/**
 * URLs containing base58-ish strings (should NOT be treated as mints)
 */
export const URL_CASES: AddressTestCase[] = [
  {
    description: 'Solscan URL path segment',
    input: 'https://solscan.io/token/abcdefghijklmnopqrstuvwxyz123456',
    expectedValid: false,
    expectedRejectionReason: 'url_component',
    category: 'url',
  },
  {
    description: 'Base58-like query parameter',
    input: 'https://example.com?token=So11111111111111111111111111111111111111112',
    expectedValid: false,
    expectedRejectionReason: 'url_component',
    category: 'url',
  },
  {
    description: 'Domain that looks like base58',
    input: 'https://So11111111111111111111111111111111111111112.com',
    expectedValid: false,
    expectedRejectionReason: 'url_component',
    category: 'url',
  },
];

/**
 * Ticker-like noise (should NOT become mints)
 */
export const NOISE_CASES: AddressTestCase[] = [
  {
    description: 'Dollar sign ticker',
    input: '$SOL',
    expectedValid: false,
    expectedRejectionReason: 'too_short',
    category: 'noise',
  },
  {
    description: 'Trading pair',
    input: 'SOL/USDT',
    expectedValid: false,
    expectedRejectionReason: 'invalid_format',
    category: 'noise',
  },
  {
    description: 'Token name',
    input: 'SOLANA',
    expectedValid: false,
    expectedRejectionReason: 'too_short',
    category: 'noise',
  },
  {
    description: 'Ticker with price',
    input: 'SOL $100.50',
    expectedValid: false,
    expectedRejectionReason: 'invalid_format',
    category: 'noise',
  },
];

/**
 * Obfuscation attempts
 */
export const OBFUSCATION_CASES: AddressTestCase[] = [
  {
    description: 'EVM address with spaces (0 x abc...)',
    input: '0 x 1234567890123456789012345678901234567890',
    expectedValid: false,
    expectedRejectionReason: 'contains_whitespace',
    category: 'obfuscation',
  },
  {
    description: 'EVM address with Cyrillic x (0х)',
    input: '0х1234567890123456789012345678901234567890',
    expectedValid: false,
    expectedRejectionReason: 'invalid_prefix',
    category: 'obfuscation',
  },
  {
    description: 'EVM address with spaces in hex part',
    input: '0x12 34 56 78 90 12 34 56 78 90 12 34 56 78 90 12 34 56 78 90',
    expectedValid: false,
    expectedRejectionReason: 'contains_whitespace',
    category: 'obfuscation',
  },
  {
    description: 'EVM address with dashes in hex part',
    input: '0x12-34-56-78-90-12-34-56-78-90-12-34-56-78-90-12-34-56-78-90',
    expectedValid: false,
    expectedRejectionReason: 'invalid_format',
    category: 'obfuscation',
  },
  {
    description: 'EVM address with dots in hex part',
    input: '0x12.34.56.78.90.12.34.56.78.90.12.34.56.78.90.12.34.56.78.90',
    expectedValid: false,
    expectedRejectionReason: 'invalid_format',
    category: 'obfuscation',
  },
  {
    description: 'EVM address with zero-width space in hex',
    input: `0x12${'\u200B'}345678901234567890123456789012345678901234567890`,
    expectedValid: false,
    expectedRejectionReason: 'invisible_character',
    category: 'obfuscation',
  },
  {
    description: 'EVM address with letter O instead of zero',
    input: '0xO123456789012345678901234567890123456789',
    expectedValid: false,
    expectedRejectionReason: 'invalid_hex',
    category: 'obfuscation',
  },
  {
    description: 'Solana address with lookalike characters (0→O, 1→l)',
    input: 'SOllllllllllllllllllllllllllllllllllllllll2',
    expectedValid: false,
    expectedRejectionReason: 'forbidden_base58_chars',
    category: 'obfuscation',
  },
  {
    description: 'Mixed case with invalid checksum',
    input: '0x1234567890aBcDeF1234567890aBcDeF12345678',
    expectedValid: false,
    expectedRejectionReason: 'invalid_checksum',
    category: 'obfuscation',
  },
];

/**
 * Validation edge cases (Solana)
 */
export const SOLANA_VALIDATION_CASES: AddressTestCase[] = [
  {
    description: 'Forbidden char: 0',
    input: 'S011111111111111111111111111111111111111112',
    expectedValid: false,
    expectedRejectionReason: 'forbidden_base58_chars',
    category: 'validation',
  },
  {
    description: 'Forbidden char: O',
    input: 'SO11111111111111111111111111111111111111112',
    expectedValid: false,
    expectedRejectionReason: 'forbidden_base58_chars',
    category: 'validation',
  },
  {
    description: 'Forbidden char: I',
    input: 'SI11111111111111111111111111111111111111112',
    expectedValid: false,
    expectedRejectionReason: 'forbidden_base58_chars',
    category: 'validation',
  },
  {
    description: 'Forbidden char: l',
    input: 'Sl11111111111111111111111111111111111111112',
    expectedValid: false,
    expectedRejectionReason: 'forbidden_base58_chars',
    category: 'validation',
  },
  {
    description: 'Too short (31 chars)',
    input: 'So1111111111111111111111111111',
    expectedValid: false,
    expectedRejectionReason: 'invalid_length',
    category: 'validation',
  },
  {
    description: 'Too long (45 chars)',
    input: 'So111111111111111111111111111111111111111112345',
    expectedValid: false,
    expectedRejectionReason: 'invalid_length',
    category: 'validation',
  },
  {
    description: 'Valid base58 but not a public key',
    input: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    expectedValid: false,
    expectedRejectionReason: 'invalid_pubkey',
    category: 'validation',
  },
];

/**
 * Validation edge cases (EVM)
 */
export const EVM_VALIDATION_CASES: AddressTestCase[] = [
  {
    description: 'Correct length but non-hex char',
    input: '0x123456789012345678901234567890123456789g',
    expectedValid: false,
    expectedRejectionReason: 'invalid_hex',
    category: 'validation',
  },
  {
    description: 'All lowercase (valid, not checksummed)',
    input: '0x1234567890123456789012345678901234567890',
    expectedValid: true,
    expectedChain: 'ethereum',
    category: 'validation',
  },
  {
    description: 'Zero address',
    input: '0x0000000000000000000000000000000000000000',
    expectedValid: false,
    expectedRejectionReason: 'zero_address',
    category: 'validation',
  },
  {
    description: 'Too short (39 chars)',
    input: '0x123456789012345678901234567890123456789',
    expectedValid: false,
    expectedRejectionReason: 'invalid_length',
    category: 'validation',
  },
  {
    description: 'Too long (43 chars)',
    input: '0x12345678901234567890123456789012345678901',
    expectedValid: false,
    expectedRejectionReason: 'invalid_length',
    category: 'validation',
  },
  {
    description: 'Missing 0x prefix',
    input: '1234567890123456789012345678901234567890',
    expectedValid: false,
    expectedRejectionReason: 'missing_prefix',
    category: 'validation',
  },
];

/**
 * Multiple candidates in one message
 */
export const MULTIPLE_CANDIDATES = `
Check out these tokens:
${VALID_SOLANA}
${VALID_EVM}
${VALID_SOLANA}
Also this one: ${VALID_EVM}
`;

/**
 * All test cases combined
 */
export const ALL_CASES: AddressTestCase[] = [
  ...PUNCTUATION_CASES,
  ...INVISIBLE_CASES,
  ...LINEBREAK_CASES,
  ...MARKDOWN_CASES,
  ...URL_CASES,
  ...NOISE_CASES,
  ...OBFUSCATION_CASES,
  ...SOLANA_VALIDATION_CASES,
  ...EVM_VALIDATION_CASES,
];
