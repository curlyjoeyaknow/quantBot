import { Row } from './types.js';
import { safeString, clamp } from './text.js';

function parseNum(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return Math.trunc(x);
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function parseTsMs(obj: unknown): number | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;

  // normalized: timestampMs
  const t = o.timestampMs ?? o.timestamp_ms;
  const n = parseNum(t);
  if (n !== null && n !== undefined && n > 0) return n;

  // quarantine might include date/date_unixtime in raw
  const raw =
    typeof o.raw === 'object' && o.raw !== null ? (o.raw as Record<string, unknown>) : null;
  const du = raw?.date_unixtime ?? o.date_unixtime;
  const secs = parseNum(du);
  if (secs !== null && secs !== undefined && secs > 0) return secs * 1000;

  const d = raw?.date ?? o.date;
  if (typeof d === 'string' && d.trim() !== '') {
    const ms = Date.parse(d);
    if (Number.isFinite(ms)) return ms;
  }

  return null;
}

function pickChatId(obj: unknown, fallback: string): string {
  if (typeof obj !== 'object' || obj === null) return fallback;
  const o = obj as Record<string, unknown>;
  return safeString(o.chatId ?? o.chat_id ?? o.chat ?? fallback) || fallback;
}

function pickFrom(obj: unknown): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const raw =
    typeof o.raw === 'object' && o.raw !== null ? (o.raw as Record<string, unknown>) : null;
  const f = o.fromName ?? o.from ?? raw?.from ?? raw?.from_name;
  const s = safeString(f);
  return s ? s : null;
}

function pickPreview(obj: unknown): string {
  if (typeof obj !== 'object' || obj === null) return '';
  const o = obj as Record<string, unknown>;
  const raw =
    typeof o.raw === 'object' && o.raw !== null ? (o.raw as Record<string, unknown>) : null;
  const t = o.text ?? raw?.text ?? raw?.message ?? o.message;
  if (typeof t === 'string') return clamp(t.replace(/\s+/g, ' ').trim(), 120);
  if (Array.isArray(t)) {
    const joined = t
      .map((p) => {
        if (typeof p === 'string') return p;
        if (typeof p === 'object' && p !== null) {
          const pObj = p as Record<string, unknown>;
          return safeString(pObj.text);
        }
        return safeString(p);
      })
      .join('');
    return clamp(joined.replace(/\s+/g, ' ').trim(), 120);
  }
  return clamp(safeString(t).replace(/\s+/g, ' ').trim(), 120);
}

export function rowFromNormalized(obj: unknown, fallbackChatId: string, lineNo: number): Row {
  if (typeof obj !== 'object' || obj === null) {
    const key = `err:${fallbackChatId}:na:${lineNo}`;
    return {
      kind: 'err',
      key,
      chatId: fallbackChatId,
      messageId: null,
      tsMs: null,
      from: null,
      preview: 'PARSE_ERROR: Invalid object',
      raw: obj,
      errorCode: 'PARSE_ERROR',
      errorMessage: 'Invalid object',
    };
  }
  const o = obj as Record<string, unknown>;
  const raw =
    typeof o.raw === 'object' && o.raw !== null ? (o.raw as Record<string, unknown>) : null;

  const chatId = pickChatId(obj, fallbackChatId);
  const messageId = parseNum(o.messageId ?? o.id ?? raw?.id);
  const tsMs = parseTsMs(obj);
  const from = pickFrom(obj);
  const preview = pickPreview(obj);

  const key = `ok:${chatId}:${messageId ?? 'na'}:${lineNo}`;
  return { kind: 'ok', key, chatId, messageId, tsMs, from, preview, raw: obj, normalized: obj };
}

export function rowFromQuarantine(obj: unknown, fallbackChatId: string, lineNo: number): Row {
  if (typeof obj !== 'object' || obj === null) {
    const key = `err:${fallbackChatId}:na:${lineNo}`;
    return {
      kind: 'err',
      key,
      chatId: fallbackChatId,
      messageId: null,
      tsMs: null,
      from: null,
      preview: 'PARSE_ERROR: Invalid object',
      raw: obj,
      errorCode: 'PARSE_ERROR',
      errorMessage: 'Invalid object',
    };
  }
  const o = obj as Record<string, unknown>;
  const raw =
    typeof o.raw === 'object' && o.raw !== null ? (o.raw as Record<string, unknown>) : null;
  const error =
    typeof o.error === 'object' && o.error !== null ? (o.error as Record<string, unknown>) : null;

  const chatId = pickChatId(obj, fallbackChatId);
  const messageId = parseNum(o.messageId ?? o.id ?? raw?.id);
  const tsMs = parseTsMs(obj);

  const code = safeString(error?.code ?? o.code ?? 'UNKNOWN');
  const msg = safeString(error?.message ?? o.message ?? 'Unknown error');

  const from = pickFrom(obj);
  const preview = clamp(`${code}: ${msg}`.replace(/\s+/g, ' ').trim(), 120);

  const key = `err:${chatId}:${messageId ?? 'na'}:${lineNo}`;
  return {
    kind: 'err',
    key,
    chatId,
    messageId,
    tsMs,
    from,
    preview,
    raw: obj,
    errorCode: code,
    errorMessage: msg,
  };
}

export function rowFromParseError(
  line: string,
  fileTag: 'normalized' | 'quarantine',
  lineNo: number
): Row {
  const code = 'PARSE_ERROR';
  const msg = `${fileTag} ndjson parse failed`;
  const key = `err:${fileTag}:na:${lineNo}`;
  return {
    kind: 'err',
    key,
    chatId: fileTag,
    messageId: null,
    tsMs: null,
    from: null,
    preview: clamp(`${code}: ${msg}`, 120),
    raw: { line, fileTag, lineNo },
    errorCode: code,
    errorMessage: msg,
  };
}
