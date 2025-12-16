/* Telegram export normalizer

   Goal: accept Telegram JSON message blobs (schema may vary),
   produce a stable canonical message or a structured error.

*/

export type NormalizedTelegramMessage = {
  chatId: string;
  messageId: number;
  type: string; // "message", "service", etc
  timestampMs: number; // unix ms
  fromName: string | null;
  fromId: string | null;
  text: string; // flattened plain text
  links: Array<{ text: string; href: string }>;
  replyToMessageId: number | null;
  isService: boolean;
  raw: unknown; // store original blob for forensic debugging
};

export type NormalizeOk = { ok: true; value: NormalizedTelegramMessage };

export type NormalizeErr = {
  ok: false;
  error: {
    code: 'MISSING_ID' | 'BAD_ID' | 'BAD_DATE' | 'UNKNOWN_SHAPE';
    message: string;
  };
  raw: unknown;
};

function safeString(x: unknown): string {
  if (x === null || x === undefined) return '';
  const s = String(x);
  // remove null bytes + normalize newlines
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000/g, '').replace(/\r\n/g, '\n');
}

function parseMessageId(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x) && x >= 0) return Math.trunc(x);
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  return null;
}

function parseTimestampMs(msg: any): number | null {
  // Telegram exports often have: date (ISO-ish string) and/or date_unixtime (string)
  const du = msg?.date_unixtime;
  const d = msg?.date;

  if (typeof du === 'string' && du.trim() !== '') {
    const secs = Number(du);
    if (Number.isFinite(secs) && secs > 0) return Math.trunc(secs * 1000);
  }
  if (typeof du === 'number' && Number.isFinite(du) && du > 0) {
    return Math.trunc(du * 1000);
  }
  if (typeof d === 'string' && d.trim() !== '') {
    const ms = Date.parse(d);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

type Link = { text: string; href: string };

function flattenText(textField: any): { text: string; links: Link[] } {
  // Telegram "text" can be:
  // - string
  // - array: [ "hi", {type:"link", text:"site", href:"..."}, ...]
  // - empty / null

  const links: Link[] = [];

  if (typeof textField === 'string') {
    return { text: safeString(textField), links };
  }

  if (!Array.isArray(textField)) {
    return { text: safeString(textField), links };
  }

  let out = '';
  for (const part of textField) {
    if (typeof part === 'string') {
      out += safeString(part);
      continue;
    }
    if (part && typeof part === 'object') {
      const t = safeString((part as any).text);
      out += t;

      const href = (part as any).href;
      if (typeof href === 'string' && href.trim() !== '') {
        links.push({ text: t, href: href.trim() });
      }
      continue;
    }
    out += safeString(part);
  }

  return { text: out, links };
}

export function normalizeTelegramMessage(
  input: unknown,
  chatId: string
): NormalizeOk | NormalizeErr {
  try {
    if (!input || typeof input !== 'object') {
      return {
        ok: false,
        error: { code: 'UNKNOWN_SHAPE', message: 'Message is not an object' },
        raw: input,
      };
    }

    const msg: any = input;
    const messageId = parseMessageId(msg.id);
    if (messageId === null) {
      return {
        ok: false,
        error: { code: 'MISSING_ID', message: 'Missing/invalid message id' },
        raw: input,
      };
    }

    const timestampMs = parseTimestampMs(msg);
    if (timestampMs === null) {
      return {
        ok: false,
        error: { code: 'BAD_DATE', message: 'Missing/invalid date/date_unixtime' },
        raw: input,
      };
    }

    const type = safeString(msg.type || 'message');
    const isService =
      type !== 'message' ||
      (msg.action !== null && msg.action !== undefined) ||
      (msg.actor !== null && msg.actor !== undefined);

    const fromName = msg.from !== null && msg.from !== undefined ? safeString(msg.from) : null;
    const fromId =
      msg.from_id !== null && msg.from_id !== undefined ? safeString(msg.from_id) : null;

    const { text, links } = flattenText(msg.text);

    const replyToMessageId =
      msg.reply_to_message_id !== null && msg.reply_to_message_id !== undefined
        ? parseMessageId(msg.reply_to_message_id)
        : null;

    const norm: NormalizedTelegramMessage = {
      chatId: safeString(chatId),
      messageId,
      type,
      timestampMs,
      fromName: fromName && fromName !== '' ? fromName : null,
      fromId: fromId && fromId !== '' ? fromId : null,
      text,
      links,
      replyToMessageId,
      isService,
      raw: input,
    };

    return { ok: true, value: norm };
  } catch (e: any) {
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_SHAPE',
        message: `Normalizer threw: ${safeString(e?.message || e)}`,
      },
      raw: input,
    };
  }
}
