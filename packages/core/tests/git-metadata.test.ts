import { describe, it, expect } from 'vitest';
import {
  getShortCommitHash,
  formatGitMetadata,
  isCleanState,
  requireCleanState,
  MockGitMetadata,
} from '../src/git-metadata.js';
import type { GitMetadata } from '../src/git-metadata.js';

describe('getShortCommitHash', () => {
  it('should return first 7 characters', () => {
    const metadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'main',
      isDirty: false,
    };

    expect(getShortCommitHash(metadata)).toBe('abcdef1');
  });
});

describe('formatGitMetadata', () => {
  it('should format clean state', () => {
    const metadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'main',
      isDirty: false,
    };

    expect(formatGitMetadata(metadata)).toBe('main@abcdef1');
  });

  it('should format dirty state', () => {
    const metadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'main',
      isDirty: true,
      uncommittedChanges: ['M file.ts'],
    };

    expect(formatGitMetadata(metadata)).toBe('main@abcdef1 (dirty)');
  });
});

describe('isCleanState', () => {
  it('should return true for clean state', () => {
    const metadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'main',
      isDirty: false,
    };

    expect(isCleanState(metadata)).toBe(true);
  });

  it('should return false for dirty state', () => {
    const metadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'main',
      isDirty: true,
      uncommittedChanges: ['M file.ts'],
    };

    expect(isCleanState(metadata)).toBe(false);
  });
});

describe('requireCleanState', () => {
  it('should not throw for clean state', () => {
    const metadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'main',
      isDirty: false,
    };

    expect(() => requireCleanState(metadata)).not.toThrow();
  });

  it('should throw for dirty state', () => {
    const metadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'main',
      isDirty: true,
      uncommittedChanges: ['M file.ts'],
    };

    expect(() => requireCleanState(metadata)).toThrow();
  });
});

describe('MockGitMetadata', () => {
  it('should return provided metadata', () => {
    const metadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'test',
      isDirty: false,
    };

    const mock = new MockGitMetadata(metadata);
    expect(mock.capture()).toEqual(metadata);
  });

  it('should check clean state', () => {
    const cleanMetadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'test',
      isDirty: false,
    };

    const dirtyMetadata: GitMetadata = {
      commitHash: 'abcdef1234567890',
      branch: 'test',
      isDirty: true,
    };

    const cleanMock = new MockGitMetadata(cleanMetadata);
    const dirtyMock = new MockGitMetadata(dirtyMetadata);

    expect(cleanMock.isClean()).toBe(true);
    expect(dirtyMock.isClean()).toBe(false);
  });
});

