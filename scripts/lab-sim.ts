/**
 * Thin lab runner entrypoint.
 * This calls into workflows; your wiring lives in scripts/lab-sim.wiring.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getArtifactsDir } from '@quantbot/core';

let YAML: any;
try {
  YAML = require('yaml');
} catch {
  YAML = null;
}

// Import type from workflows package (using relative path since it's not exported from index)
type SimPresetV1 = {
  kind: 'sim_preset_v1';
  name: string;
  description?: string;
  data: {
    dataset: 'candles_1m' | 'candles_5m';
    chain: 'sol' | 'eth' | 'base' | 'bsc';
    interval: '1m' | '5m' | '1h' | '1d';
    time_range: { start: string; end: string };
    tokens_file: string;
  };
  features: any;
  strategy: any;
  risk: any;
};

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
function sha(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function listPresets(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => path.join(dir, f))
    .sort();
}

function loadYaml<T>(p: string): T {
  if (!YAML) die("Missing 'yaml' devDependency. Install: pnpm add -D yaml");
  return YAML.parse(fs.readFileSync(p, 'utf8')) as T;
}

function readTokens(p: string): string[] {
  if (!fs.existsSync(p)) die(`tokens_file missing: ${p}`);
  return fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith('#'));
}

async function main() {
  const cmd = process.argv[2] ?? 'list';
  const presetDir = 'lab/presets/sim';

  const files = listPresets(presetDir);
  if (files.length === 0) die(`No presets found in ${presetDir}`);

  const presets = files.map((f) => loadYaml<SimPresetV1>(f));
  const byName = new Map(presets.map((p) => [p.name, p] as const));

  if (cmd === 'list') {
    console.log(`Presets:`);
    for (const p of presets)
      console.log(`- ${p.name}${p.description ? ` — ${p.description}` : ''}`);
    return;
  }

  if (cmd !== 'run') die(`Usage: pnpm lab:sim list | run <presetName...>`);

  const names = process.argv.slice(3);
  if (names.length === 0) die('No presets selected.');

  const selected: SimPresetV1[] = names.map((n) => {
    const p = byName.get(n);
    if (!p) die(`Unknown preset: ${n}`);
    return p;
  });

  const runId = `lab_${sha(JSON.stringify({ t: new Date().toISOString(), presets: names })).slice(0, 12)}`;
  const createdAtIso = new Date().toISOString();

  const tokenSets: Record<string, string[]> = {};
  for (const p of selected) tokenSets[p.data.tokens_file] = readTokens(p.data.tokens_file);

  const { runSelectedPresets } = await import('./lab-sim.wiring');
  const res = await runSelectedPresets({
    runId,
    createdAtIso,
    presets: selected,
    tokenSets,
    artifactRootDir: path.join(getArtifactsDir(), 'lab'),
  });

  if (res.length === 0) {
    console.warn('\nWARNING: No results generated. All presets may have failed.');
    return;
  }

  console.log('\n=== RESULTS (pnl desc) ===');
  const sorted = (res as any[]).sort((a: any, b: any) => {
    const aPnl = a?.summary?.pnlQuote ?? 0;
    const bPnl = b?.summary?.pnlQuote ?? 0;
    return bPnl - aPnl;
  });
  for (const r of sorted) {
    if (!r?.summary) continue;
    const s = r.summary as any;
    console.log(
      `${s.presetName.padEnd(28)} pnl=${(s.pnlQuote ?? 0).toFixed(2).padEnd(10)} dd=${(s.maxDrawdownQuote ?? 0).toFixed(2).padEnd(10)} trades=${s.trades ?? 0} win=${((s.winRate ?? 0) * 100).toFixed(1).padEnd(5)}%`
    );
  }
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
