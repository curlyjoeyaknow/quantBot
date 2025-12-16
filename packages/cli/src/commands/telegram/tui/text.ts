export function safeString(x: unknown): string {
  if (x === null || x === undefined) return '';
  return (
    String(x)
      // eslint-disable-next-line no-control-regex
      .replace(/\u0000/g, '')
      .replace(/\r\n/g, '\n')
  );
}

export function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + '…';
}

export function fmtTime(tsMs: number | null): string {
  if (!tsMs || !Number.isFinite(tsMs)) return '—';
  const d = new Date(tsMs);
  if (Number.isNaN(d.getTime())) return '—';
  // 2025-12-15 18:03:12
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function prettyJson(x: unknown, maxChars: number): string {
  let s = '';
  try {
    s = JSON.stringify(x, null, 2) ?? '';
  } catch {
    s = '[unstringifiable json]';
  }
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 1)) + '…';
}

export function truncateToBox(text: string, maxLines: number, maxCols: number): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length && out.length < maxLines; i++) {
    out.push(clamp(lines[i], Math.max(1, maxCols)));
  }
  return out.join('\n');
}
