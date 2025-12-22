/**
 * Config Loader Tests
 *
 * Tests for YAML/JSON config loading, CLI override merging, and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { detectConfigFormat, deepMerge, loadConfig } from '../../../src/core/config-loader.js';

const TEST_DIR = join(process.cwd(), '.test-config-loader');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('detectConfigFormat', () => {
  it('detects YAML format from .yaml extension', () => {
    expect(detectConfigFormat('config.yaml')).toBe('yaml');
  });

  it('detects YAML format from .yml extension', () => {
    expect(detectConfigFormat('config.yml')).toBe('yaml');
  });

  it('detects JSON format from .json extension', () => {
    expect(detectConfigFormat('config.json')).toBe('json');
  });

  it('defaults to JSON for unknown extensions', () => {
    expect(detectConfigFormat('config.txt')).toBe('json');
    expect(detectConfigFormat('config')).toBe('json');
  });
});

describe('deepMerge', () => {
  it('merges simple objects', () => {
    const base = { a: 1, b: 2 };
    const override = { b: 3, c: 4 };
    const result = deepMerge(base, override);

    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('performs deep merge on nested objects', () => {
    const base = { a: { x: 1, y: 2 }, b: 3 };
    const override = { a: { y: 3, z: 4 }, c: 5 };
    const result = deepMerge(base, override);

    expect(result).toEqual({
      a: { x: 1, y: 3, z: 4 },
      b: 3,
      c: 5,
    });
  });

  it('replaces arrays (no merging)', () => {
    const base = { items: [1, 2, 3] };
    const override = { items: [4, 5] };
    const result = deepMerge(base, override);

    expect(result).toEqual({ items: [4, 5] });
  });

  it('skips undefined values from override', () => {
    const base = { a: 1, b: 2 };
    const override = { b: undefined, c: 3 };
    const result = deepMerge(base, override);

    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('replaces null values', () => {
    const base = { a: { x: 1 } };
    const override = { a: null };
    const result = deepMerge(base, override);

    expect(result).toEqual({ a: null });
  });

  it('handles complex nested structures', () => {
    const base = {
      server: {
        host: 'localhost',
        port: 3000,
        options: { timeout: 5000 },
      },
      logging: { level: 'info' },
    };
    const override = {
      server: {
        port: 8080,
        options: { retries: 3 },
      },
      logging: { level: 'debug' },
    };
    const result = deepMerge(base, override);

    expect(result).toEqual({
      server: {
        host: 'localhost',
        port: 8080,
        options: { timeout: 5000, retries: 3 },
      },
      logging: { level: 'debug' },
    });
  });
});

describe('loadConfig', () => {
  const testSchema = z.object({
    name: z.string(),
    count: z.number(),
    enabled: z.boolean().default(true),
  });

  it('loads JSON config', async () => {
    const configPath = join(TEST_DIR, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        name: 'test',
        count: 42,
      })
    );

    const config = await loadConfig(configPath, testSchema);

    expect(config).toEqual({
      name: 'test',
      count: 42,
      enabled: true, // Default value
    });
  });

  it('loads YAML config', async () => {
    const configPath = join(TEST_DIR, 'config.yaml');
    writeFileSync(
      configPath,
      `
name: test
count: 42
    `.trim()
    );

    const config = await loadConfig(configPath, testSchema);

    expect(config).toEqual({
      name: 'test',
      count: 42,
      enabled: true,
    });
  });

  it('merges CLI overrides into config', async () => {
    const configPath = join(TEST_DIR, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        name: 'test',
        count: 42,
      })
    );

    const config = await loadConfig(configPath, testSchema, {
      count: 100,
      enabled: false,
    });

    expect(config).toEqual({
      name: 'test',
      count: 100,
      enabled: false,
    });
  });

  it('performs deep merge for nested overrides', async () => {
    const nestedSchema = z.object({
      server: z.object({
        host: z.string(),
        port: z.number(),
      }),
    });

    const configPath = join(TEST_DIR, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        server: {
          host: 'localhost',
          port: 3000,
        },
      })
    );

    const config = await loadConfig(configPath, nestedSchema, {
      server: {
        port: 8080,
      },
    });

    expect(config).toEqual({
      server: {
        host: 'localhost',
        port: 8080,
      },
    });
  });

  it('throws ValidationError on invalid config', async () => {
    const configPath = join(TEST_DIR, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        name: 'test',
        count: 'not-a-number', // Invalid type
      })
    );

    await expect(loadConfig(configPath, testSchema)).rejects.toThrow(/Config validation failed/);
  });

  it('throws ValidationError if config is not an object', async () => {
    const configPath = join(TEST_DIR, 'config.json');
    writeFileSync(configPath, JSON.stringify(['array', 'not', 'object']));

    await expect(loadConfig(configPath, testSchema)).rejects.toThrow(/must be an object/);
  });

  it('throws ValidationError if YAML is not an object', async () => {
    const configPath = join(TEST_DIR, 'config.yaml');
    writeFileSync(configPath, '- array\n- not\n- object');

    await expect(loadConfig(configPath, testSchema)).rejects.toThrow(/must be an object/);
  });

  it('throws ValidationError on malformed JSON', async () => {
    const configPath = join(TEST_DIR, 'config.json');
    writeFileSync(configPath, '{ invalid json }');

    await expect(loadConfig(configPath, testSchema)).rejects.toThrow(/Failed to load config/);
  });

  it('throws ValidationError on malformed YAML', async () => {
    const configPath = join(TEST_DIR, 'config.yaml');
    writeFileSync(configPath, 'invalid: yaml: with: too: many: colons:::');

    await expect(loadConfig(configPath, testSchema)).rejects.toThrow(/Failed to load config/);
  });
});
