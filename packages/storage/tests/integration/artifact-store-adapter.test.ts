import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ArtifactStoreAdapter } from '../../src/adapters/artifact-store-adapter.js';
import { PythonEngine } from '@quantbot/utils';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ArtifactStoreAdapter (integration)', () => {
  const testDir = join(tmpdir(), `artifact-store-test-${Date.now()}`);
  const manifestDb = join(testDir, 'manifest.sqlite');
  const artifactsRoot = join(testDir, 'artifacts');

  let adapter: ArtifactStoreAdapter;

  // Helper to create unique test data for each test
  function createTestData(uniqueId: string): string {
    const testDataPath = join(testDir, `test-data-${uniqueId}.csv`);
    writeFileSync(
      testDataPath,
      `alert_ts_utc,chain,mint,alert_id\n2025-05-01T00:00:00Z,solana,ABC123-${uniqueId},alert-${uniqueId}\n`
    );
    return testDataPath;
  }

  beforeAll(() => {
    // Create test directories
    mkdirSync(testDir, { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });

    // Create adapter with PythonEngine (required for artifact operations)
    const pythonEngine = new PythonEngine();
    adapter = new ArtifactStoreAdapter(manifestDb, artifactsRoot, pythonEngine);
  });

  afterAll(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should check availability', async () => {
    // Database is created on first publish, so we need to publish an artifact first
    // or check availability after database is created
    const testDataPath = createTestData('availability');
    await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/availability/check',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
    });
    
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('should publish and retrieve artifact', async () => {
    // Use unique logical key and data to avoid deduplication from previous tests
    const uniqueKey = `test/integration/key1-${Date.now()}`;
    const testDataPath = createTestData(`integration-${Date.now()}`);
    // Publish artifact
    const publishResult = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: uniqueKey,
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
      tags: { test: 'integration' },
    });

    expect(publishResult.success).toBe(true);
    // If deduped, use existingArtifactId; otherwise use artifactId
    const artifactId = publishResult.deduped ? publishResult.existingArtifactId : publishResult.artifactId;
    expect(artifactId).toBeDefined();

    // Retrieve artifact
    const artifact = await adapter.getArtifact(artifactId!);
    expect(artifact.artifactId).toBe(artifactId);
    expect(artifact.artifactType).toBe('test_artifact');
    expect(artifact.logicalKey).toBe(uniqueKey);
    expect(artifact.status).toBe('active');
  });

  it('should deduplicate identical artifacts', async () => {
    // Use unique logical key and shared data file for deduplication test
    const uniqueKey = `test/dedup/key1-${Date.now()}`;
    const testDataPath = createTestData(`dedup-${Date.now()}`);
    // Publish first artifact
    const result1 = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: uniqueKey,
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
    });

    expect(result1.deduped).toBe(false);
    const artifactId1 = result1.artifactId || result1.existingArtifactId;
    expect(artifactId1).toBeDefined();

    // Publish same artifact again (should deduplicate)
    const result2 = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: uniqueKey,
      dataPath: testDataPath, // Same file = same content hash = deduplication
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
    });

    expect(result2.deduped).toBe(true);
    expect(result2.existingArtifactId).toBe(artifactId1);
  });

  it('should list artifacts with filters', async () => {
    // Publish artifact with tags
    await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/list/key1',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
      tags: { environment: 'test', purpose: 'integration' },
    });

    // List artifacts
    const artifacts = await adapter.listArtifacts({
      artifactType: 'test_artifact',
      status: 'active',
      limit: 10,
    });

    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts.every((a) => a.artifactType === 'test_artifact')).toBe(true);
    expect(artifacts.every((a) => a.status === 'active')).toBe(true);
  });

  it('should find artifacts by logical key', async () => {
    // Use unique logical key and data to avoid deduplication from previous tests
    const uniqueKey = `test/find/unique-key-${Date.now()}`;
    const testDataPath = createTestData(`find-${Date.now()}`);
    // Publish artifact
    const publishResult = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: uniqueKey,
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
    });

    // Get artifact ID (handle deduplication)
    const artifactId = publishResult.deduped ? publishResult.existingArtifactId : publishResult.artifactId;
    expect(artifactId).toBeDefined();

    // Find by logical key
    const artifacts = await adapter.findByLogicalKey('test_artifact', uniqueKey);

    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts[0].artifactId).toBe(artifactId);
    expect(artifacts[0].logicalKey).toBe(uniqueKey);
  });

  it('should track lineage', async () => {
    // Use unique logical keys and data to avoid deduplication
    const timestamp = Date.now();
    const inputDataPath = createTestData(`lineage-input-${timestamp}`);
    const outputDataPath = createTestData(`lineage-output-${timestamp}`);
    // Publish input artifact
    const input1 = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: `test/lineage/input1-${timestamp}`,
      dataPath: inputDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
    });

    const input1Id = input1.deduped ? input1.existingArtifactId : input1.artifactId;
    expect(input1Id).toBeDefined();

    // Publish output artifact with lineage
    const output = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: `test/lineage/output1-${timestamp}`,
      dataPath: outputDataPath,
      inputArtifactIds: [input1Id!],
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
    });

    const outputId = output.deduped ? output.existingArtifactId : output.artifactId;
    expect(outputId).toBeDefined();

    // Get lineage
    const lineage = await adapter.getLineage(outputId!);

    expect(lineage.artifactId).toBe(outputId);
    expect(lineage.inputs.length).toBe(1);
    expect(lineage.inputs[0].artifactId).toBe(input1Id);
  });

  it('should get downstream artifacts', async () => {
    // Use unique logical keys and data to avoid deduplication
    const timestamp = Date.now();
    const inputDataPath = createTestData(`downstream-input-${timestamp}`);
    const outputDataPath = createTestData(`downstream-output-${timestamp}`);
    // Publish input artifact
    const input = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: `test/downstream/input1-${timestamp}`,
      dataPath: inputDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
    });

    const inputId = input.deduped ? input.existingArtifactId : input.artifactId;
    expect(inputId).toBeDefined();

    // Publish output artifact
    const output = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: `test/downstream/output1-${timestamp}`,
      dataPath: outputDataPath,
      inputArtifactIds: [inputId!],
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
    });

    const outputId = output.deduped ? output.existingArtifactId : output.artifactId;
    expect(outputId).toBeDefined();

    // Get downstream
    const downstream = await adapter.getDownstream(inputId!);

    expect(downstream.length).toBeGreaterThan(0);
    expect(downstream.some((a) => a.artifactId === outputId)).toBe(true);
  });

  it('should supersede artifacts', async () => {
    // Use unique logical keys and data to avoid deduplication
    const timestamp = Date.now();
    const oldDataPath = createTestData(`supersede-old-${timestamp}`);
    const newDataPath = createTestData(`supersede-new-${timestamp}`);
    // Publish old artifact
    const old = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: `test/supersede/old-${timestamp}`,
      dataPath: oldDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit123',
      gitDirty: false,
    });

    const oldId = old.deduped ? old.existingArtifactId : old.artifactId;
    expect(oldId).toBeDefined();

    // Publish new artifact
    const newArtifact = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: `test/supersede/new-${timestamp}`,
      dataPath: newDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'testcommit456',
      gitDirty: false,
    });

    const newId = newArtifact.deduped ? newArtifact.existingArtifactId : newArtifact.artifactId;
    expect(newId).toBeDefined();

    // Supersede old with new
    await adapter.supersede(newId!, oldId!);

    // Verify old artifact is superseded
    const oldArtifact = await adapter.getArtifact(oldId!);
    expect(oldArtifact.status).toBe('superseded');
  });
});
