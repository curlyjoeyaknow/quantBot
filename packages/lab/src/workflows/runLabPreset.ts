import crypto from 'node:crypto';
import type { LabPorts, RunContext, SimPresetV1 } from './types.js';

function sha(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export async function runLabPreset(args: {
  preset: SimPresetV1;
  tokenIds: string[];
  ports: LabPorts;
  run: RunContext;
  artifactRootDir: string;
  windowId?: string;
}) {
  const artifactDir = `${args.artifactRootDir}/run_id=${args.run.runId}/preset=${args.preset.name}${args.windowId ? `/window=${args.windowId}` : ''}`;

  const slice = await args.ports.slice.exportSlice({
    run: args.run,
    artifactDir,
    spec: {
      dataset: args.preset.data.dataset,
      chain: args.preset.data.chain,
      interval: args.preset.data.interval,
      startIso: args.preset.data.time_range.start,
      endIso: args.preset.data.time_range.end,
      tokenIds: args.tokenIds,
    },
  });

  const features = await args.ports.features.compute({
    run: args.run,
    sliceManifestPath: slice.manifestPath,
    sliceHash: slice.sliceHash,
    featureSpec: args.preset.features,
    artifactDir,
  });

  const configHash = sha(
    JSON.stringify({ strategy: args.preset.strategy, risk: args.preset.risk })
  );

  const sim = await args.ports.simulation.run({
    run: args.run,
    presetName: args.preset.name,
    windowId: args.windowId,
    sliceManifestPath: slice.manifestPath,
    sliceHash: slice.sliceHash,
    features,
    strategy: args.preset.strategy,
    risk: args.preset.risk,
    artifactDir,
  });

  // attach config hash (simulation adapter may already compute)
  sim.summary.configHash = sim.summary.configHash || configHash;

  await args.ports.leaderboard.ingest({ run: args.run, summary: sim.summary });
  return sim;
}
