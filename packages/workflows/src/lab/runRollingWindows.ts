import type { LabPorts, RunContext, SimPresetV1 } from './types.js';
import { runLabPreset } from './runLabPreset.js';

export interface RollingWindowV1 {
  train: { start: string; end: string };
  test: { start: string; end: string };
}

export async function runRollingWindows(args: {
  preset: SimPresetV1;
  tokenIds: string[];
  windows: RollingWindowV1[];
  ports: LabPorts;
  run: RunContext;
  artifactRootDir: string;
}) {
  const results = [];
  for (let i = 0; i < args.windows.length; i++) {
    const w = args.windows[i];
    const windowId = `w${String(i).padStart(3, '0')}`;

    // MVP: backtest on test range. Train range is for later (parameter fitting / model)
    if (!w) {
      throw new Error(`Window at index ${i} is undefined`);
    }
    const windowPreset: SimPresetV1 = {
      ...args.preset,
      data: { ...args.preset.data, time_range: { start: w.test.start, end: w.test.end } },
    };

    results.push(
      await runLabPreset({
        preset: windowPreset,
        tokenIds: args.tokenIds,
        ports: args.ports,
        run: args.run,
        artifactRootDir: args.artifactRootDir,
        windowId,
      })
    );
  }
  return results;
}
