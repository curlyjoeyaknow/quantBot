#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";

// minipass-json-stream is CJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSONStream = require("minipass-json-stream");

type Args = {
  inPath: string;
  outOk: string;
  outErr: string;
  onlyChatIndex?: number;  // filter for full exports (chats.list.<idx>)
  maxMessages?: number;
  quiet?: boolean;
};

type NormalizedTelegramMessage = {
  chatIndex: number | null;
  messageIndex: number | null;
  chatIdHint: string | null;     // if present in export, otherwise null
  messageId: number | null;
  type: string;
  timestampMs: number | null;
  fromName: string | null;
  fromId: string | null;
  text: string;
  links: Array<{ text: string; href: string }>;
  replyToMessageId: number | null;
  isService: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (k: string, s?: string) => {
    const i = argv.indexOf(k);
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
    if (s) {
      const j = argv.indexOf(s);
      if (j >= 0 && j + 1 < argv.length) return argv[j + 1];
    }
    return undefined;
  };
  const getNum = (k: string, s?: string) => {
    const v = get(k, s);
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
  };

  return {
    inPath: get("--in", "-i") ?? "result.json",
    outOk: get("--out-ok", "-o") ?? "data/normalized_messages.ndjson",
    outErr: get("--out-err", "-e") ?? "data/quarantine.ndjson",
    onlyChatIndex: getNum("--chat-index", "-c"),
    maxMessages: getNum("--max-messages", "-m"),
    quiet: argv.includes("--quiet"),
  };
}

function ensureDir(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function safeString(x: unknown): string {
  if (x == null) return "";
  return String(x).replace(/\u0000/g, "").replace(/\r\n/g, "\n");
}
function parseIntish(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return Math.trunc(x);
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}
function parseTimestampMs(msg: any): number | null {
  const du = msg?.date_unixtime;
  const d = msg?.date;
  if (typeof du === "string" && du.trim() !== "") {
    const secs = Number(du);
    if (Number.isFinite(secs) && secs > 0) return Math.trunc(secs * 1000);
  }
  if (typeof du === "number" && Number.isFinite(du) && du > 0) return Math.trunc(du * 1000);
  if (typeof d === "string" && d.trim() !== "") {
    const ms = Date.parse(d);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}
function flattenText(textField: any): { text: string; links: Array<{ text: string; href: string }> } {
  const links: Array<{ text: string; href: string }> = [];
  if (typeof textField === "string") return { text: safeString(textField), links };
  if (!Array.isArray(textField)) return { text: safeString(textField), links };

  let out = "";
  for (const part of textField) {
    if (typeof part === "string") {
      out += safeString(part);
      continue;
    }
    if (part && typeof part === "object") {
      const t = safeString((part as any).text);
      out += t;
      const href = (part as any).href;
      if (typeof href === "string" && href.trim() !== "") links.push({ text: t, href: href.trim() });
      continue;
    }
    out += safeString(part);
  }
  return { text: out, links };
}

function normalizeMessage(msg: any, chatIndex: number | null, messageIndex: number | null): NormalizedTelegramMessage {
  const messageId = parseIntish(msg?.id);
  const timestampMs = parseTimestampMs(msg);
  const type = safeString(msg?.type || "message");
  const isService = type !== "message" || msg?.action != null || msg?.actor != null;

  const fromName = msg?.from != null ? safeString(msg.from) : null;
  const fromId = msg?.from_id != null ? safeString(msg.from_id) : null;

  const { text, links } = flattenText(msg?.text);

  const replyToMessageId = msg?.reply_to_message_id != null ? parseIntish(msg.reply_to_message_id) : null;

  // Sometimes exports include chat id at root/single-chat level; usually not on each message.
  const chatIdHint =
    msg?.chat_id != null ? safeString(msg.chat_id) :
    msg?.peer_id != null ? safeString(msg.peer_id) :
    null;

  return {
    chatIndex,
    messageIndex,
    chatIdHint,
    messageId,
    type,
    timestampMs,
    fromName: fromName && fromName !== "" ? fromName : null,
    fromId: fromId && fromId !== "" ? fromId : null,
    text,
    links,
    replyToMessageId,
    isService,
  };
}

function parsePathIndices(p: any): { chatIndex: number | null; messageIndex: number | null } {
  // With emitPath, minipass-json-stream provides {path, value}. Path is typically an array.
  // For full export pattern: ['chats','list',<chatIndex>,'messages',<messageIndex>]
  // For single export pattern: ['messages',<messageIndex>]
  if (!Array.isArray(p)) return { chatIndex: null, messageIndex: null };

  // Full export
  if (p.length >= 5 && p[0] === "chats" && p[1] === "list" && p[3] === "messages") {
    const ci = typeof p[2] === "number" ? p[2] : parseIntish(p[2]);
    const mi = typeof p[4] === "number" ? p[4] : parseIntish(p[4]);
    return { chatIndex: ci ?? null, messageIndex: mi ?? null };
  }

  // Single chat export
  if (p.length >= 2 && p[0] === "messages") {
    const mi = typeof p[1] === "number" ? p[1] : parseIntish(p[1]);
    return { chatIndex: null, messageIndex: mi ?? null };
  }

  return { chatIndex: null, messageIndex: null };
}

async function streamMessagesOnce(
  inPath: string,
  pattern: any,
  args: Args,
  okStream: fs.WriteStream,
  errStream: fs.WriteStream
): Promise<{ ok: number; err: number; seen: number }> {
  let ok = 0;
  let err = 0;
  let seen = 0;

  const rs = fs.createReadStream(inPath, { encoding: "utf8" });
  const js = JSONStream.parse(pattern);

  // Manual backpressure control (works reliably across stream implementations)
  const writeLine = async (ws: fs.WriteStream, line: string) => {
    if (!ws.write(line + "\n")) await once(ws, "drain");
  };

  rs.pipe(js);

  js.on("data", async (data: any) => {
    js.pause();

    try {
      const value = data?.value ?? data; // if emitPath is off, value is the object
      const pathArr = data?.path ?? null;

      // Skip non-object values (primitives like numbers, strings, etc.)
      if (value == null || typeof value !== "object" || Array.isArray(value)) {
        js.resume();
        return;
      }

      // For single-chat pattern, path should be exactly ["messages", index] for message objects
      // For full-export pattern, path should be ["chats", "list", chatIndex, "messages", messageIndex]
      if (pathArr && Array.isArray(pathArr)) {
        // Single-chat: skip if path is deeper than ["messages", index] (e.g., ["messages", 0, "id"])
        if (pathArr[0] === "messages" && pathArr.length !== 2) {
          // This is a property within a message, not the message object itself
          js.resume();
          return;
        }
        // Full export: skip if path is deeper than expected (should be exactly 5 elements)
        if (pathArr[0] === "chats" && pathArr[1] === "list" && pathArr[3] === "messages" && pathArr.length !== 5) {
          // This is a property within a message, not the message object itself
          js.resume();
          return;
        }
      }

      const { chatIndex, messageIndex } = parsePathIndices(pathArr);

      if (args.onlyChatIndex != null && chatIndex != null && chatIndex !== args.onlyChatIndex) {
        js.resume();
        return;
      }

      if (args.maxMessages != null && seen >= args.maxMessages) {
        rs.destroy();
        js.destroy();
        return;
      }

      seen++;

      const norm = normalizeMessage(value, chatIndex, messageIndex);

      // Basic sanity: if there's no timestamp and no id, quarantine it.
      if (norm.timestampMs == null && norm.messageId == null) {
        err++;
        await writeLine(
          errStream,
          JSON.stringify(
            {
              chatIndex,
              messageIndex,
              reason: "Missing timestamp and id",
              raw: value,
            },
            null,
            0
          )
        );
      } else {
        ok++;
        await writeLine(okStream, JSON.stringify(norm, null, 0));
      }

      if (!args.quiet && (ok + err) % 10000 === 0) {
        // eslint-disable-next-line no-console
        console.error(`processed=${ok + err} ok=${ok} err=${err}`);
      }
    } catch (e: any) {
      err++;
      await writeLine(
        errStream,
        JSON.stringify(
          {
            reason: `Exception in stream handler: ${safeString(e?.message || e)}`,
            raw: data,
          },
          null,
          0
        )
      );
    } finally {
      js.resume();
    }
  });

  await new Promise<void>((resolve, reject) => {
    js.on("error", reject);
    rs.on("error", reject);
    js.on("end", () => resolve());
    rs.on("end", () => resolve());
    rs.on("close", () => resolve());
  });

  return { ok, err, seen };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.inPath)) throw new Error(`Input not found: ${args.inPath}`);

  ensureDir(args.outOk);
  ensureDir(args.outErr);

  const okStream = fs.createWriteStream(args.outOk, { encoding: "utf8" });
  const errStream = fs.createWriteStream(args.outErr, { encoding: "utf8" });

  // Try full-export pattern first:
  // chats.list.*.messages.*
  // Using {emitPath:true} so we can recover chatIndex/messageIndex
  const fullPattern = ["chats", "list", true, "messages", true, { emitPath: true }];

  // Fallback: single-chat export messages.*
  // Match message objects directly (path will be ["messages", index])
  const singlePattern = ["messages", true, { emitPath: true }];

  if (!args.quiet) {
    // eslint-disable-next-line no-console
    console.error(`IN  : ${args.inPath}`);
    // eslint-disable-next-line no-console
    console.error(`OK  : ${args.outOk}`);
    // eslint-disable-next-line no-console
    console.error(`ERR : ${args.outErr}`);
  }

  let result = await streamMessagesOnce(args.inPath, fullPattern, args, okStream, errStream);

  // If we didn't see any messages, try the single-chat shape.
  if (result.seen === 0) {
    if (!args.quiet) {
      // eslint-disable-next-line no-console
      console.error(`No messages via full-export pattern; trying single-chat pattern...`);
    }
    result = await streamMessagesOnce(args.inPath, singlePattern, args, okStream, errStream);
  }

  okStream.end();
  errStream.end();

  if (!args.quiet) {
    // eslint-disable-next-line no-console
    console.error(`DONE seen=${result.seen} ok=${result.ok} err=${result.err}`);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.stack || e.message : String(e);
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
});

