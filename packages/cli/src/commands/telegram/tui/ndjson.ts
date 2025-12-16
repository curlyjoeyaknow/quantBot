import fs from 'node:fs';
import readline from 'node:readline';

export type NdjsonHandlers = {
  onObject: (obj: unknown, meta: { lineNo: number }) => void;
  onParseError: (err: Error, meta: { lineNo: number; line: string }) => void;
  onDone?: () => void;
};

export function streamNdjsonFile(
  path: string,
  handlers: NdjsonHandlers,
  opts?: { maxLines?: number; signal?: AbortSignal }
): () => void {
  const maxLines = opts?.maxLines ?? Infinity;

  const rs = fs.createReadStream(path, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });

  let lineNo = 0;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      rl.close();
    } catch {
      // Ignore close errors
    }
    try {
      rs.close();
    } catch {
      // Ignore close errors
    }
  };

  const sig = opts?.signal;
  if (sig) {
    if (sig.aborted) stop();
    sig.addEventListener('abort', stop, { once: true });
  }

  rl.on('line', (line: string) => {
    if (stopped) return;
    lineNo += 1;
    if (lineNo > maxLines) {
      stop();
      handlers.onDone?.();
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const obj = JSON.parse(trimmed);
      handlers.onObject(obj, { lineNo });
    } catch (e: any) {
      const err = e instanceof Error ? e : new Error(String(e));
      handlers.onParseError(err, { lineNo, line });
    }
  });

  rl.on('close', () => {
    if (stopped) return;
    handlers.onDone?.();
  });

  rl.on('error', () => {
    handlers.onDone?.();
  });

  rs.on('error', () => {
    handlers.onDone?.();
  });

  return stop;
}
