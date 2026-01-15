import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeParameterHash,
  compareParameters,
  InMemoryParameterHashRepository,
  ParameterDeduplicationService,
} from '../src/parameter-hash.js';
import type { ParameterVector } from '../src/parameter-hash.js';

describe('computeParameterHash', () => {
  it('should produce consistent hashes', () => {
    const params1 = { a: 1, b: 2, c: 3 };
    const params2 = { c: 3, a: 1, b: 2 }; // Different order

    const hash1 = computeParameterHash(params1);
    const hash2 = computeParameterHash(params2);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different parameters', () => {
    const params1 = { a: 1, b: 2 };
    const params2 = { a: 1, b: 3 };

    const hash1 = computeParameterHash(params1);
    const hash2 = computeParameterHash(params2);

    expect(hash1).not.toBe(hash2);
  });
});

describe('compareParameters', () => {
  it('should detect identical parameters', () => {
    const params1 = { a: 1, b: 2 };
    const params2 = { a: 1, b: 2 };

    const result = compareParameters(params1, params2);

    expect(result.identical).toBe(true);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('should detect added parameters', () => {
    const params1 = { a: 1 };
    const params2 = { a: 1, b: 2 };

    const result = compareParameters(params1, params2);

    expect(result.identical).toBe(false);
    expect(result.added).toEqual(['b']);
  });

  it('should detect removed parameters', () => {
    const params1 = { a: 1, b: 2 };
    const params2 = { a: 1 };

    const result = compareParameters(params1, params2);

    expect(result.identical).toBe(false);
    expect(result.removed).toEqual(['b']);
  });

  it('should detect changed parameters', () => {
    const params1 = { a: 1, b: 2 };
    const params2 = { a: 1, b: 3 };

    const result = compareParameters(params1, params2);

    expect(result.identical).toBe(false);
    expect(result.changed).toEqual(['b']);
  });
});

describe('InMemoryParameterHashRepository', () => {
  let repo: InMemoryParameterHashRepository;

  beforeEach(() => {
    repo = new InMemoryParameterHashRepository();
  });

  it('should store and retrieve parameter hashes', async () => {
    const params = { a: 1, b: 2 };
    const hash = computeParameterHash(params);

    await repo.put({
      parameterHash: hash,
      parameters: params,
      createdAt: Date.now(),
      experimentIds: ['exp-1'],
    });

    const retrieved = await repo.get(hash);
    expect(retrieved).toBeTruthy();
    expect(retrieved?.parameters).toEqual(params);
  });

  it('should check existence', async () => {
    const params = { a: 1, b: 2 };
    const hash = computeParameterHash(params);

    let exists = await repo.exists(hash);
    expect(exists).toBe(false);

    await repo.put({
      parameterHash: hash,
      parameters: params,
      createdAt: Date.now(),
      experimentIds: ['exp-1'],
    });

    exists = await repo.exists(hash);
    expect(exists).toBe(true);
  });

  it('should add experiments to existing hash', async () => {
    const params = { a: 1, b: 2 };
    const hash = computeParameterHash(params);

    await repo.put({
      parameterHash: hash,
      parameters: params,
      createdAt: Date.now(),
      experimentIds: ['exp-1'],
    });

    await repo.addExperiment(hash, 'exp-2');

    const experiments = await repo.getExperiments(hash);
    expect(experiments).toEqual(['exp-1', 'exp-2']);
  });
});

describe('ParameterDeduplicationService', () => {
  let repo: InMemoryParameterHashRepository;
  let service: ParameterDeduplicationService;

  beforeEach(() => {
    repo = new InMemoryParameterHashRepository();
    service = new ParameterDeduplicationService(repo);
  });

  it('should register new parameters', async () => {
    const params = { a: 1, b: 2 };

    const result = await service.register('exp-1', params);

    expect(result.isDuplicate).toBe(false);
    expect(result.existingExperiments).toHaveLength(0);
  });

  it('should detect duplicate parameters', async () => {
    const params = { a: 1, b: 2 };

    await service.register('exp-1', params);
    const result = await service.register('exp-2', params);

    expect(result.isDuplicate).toBe(true);
    expect(result.existingExperiments).toContain('exp-1');
  });

  it('should check for duplicates without registering', async () => {
    const params = { a: 1, b: 2 };

    let isDup = await service.isDuplicate(params);
    expect(isDup).toBe(false);

    await service.register('exp-1', params);

    isDup = await service.isDuplicate(params);
    expect(isDup).toBe(true);
  });

  it('should find duplicate experiments', async () => {
    const params = { a: 1, b: 2 };

    await service.register('exp-1', params);
    await service.register('exp-2', params);
    await service.register('exp-3', params);

    const duplicates = await service.findDuplicates(params);
    expect(duplicates).toHaveLength(3);
    expect(duplicates).toContain('exp-1');
    expect(duplicates).toContain('exp-2');
    expect(duplicates).toContain('exp-3');
  });
});

