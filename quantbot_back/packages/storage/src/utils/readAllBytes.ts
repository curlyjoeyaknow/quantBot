import { Readable } from 'node:stream';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isWebReadableStream(x: any): x is ReadableStream<Uint8Array> {
  return !!x && typeof x.getReader === 'function';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNodeReadableStream(x: any): x is NodeJS.ReadableStream {
  return !!x && (typeof x.on === 'function' || typeof x.pipe === 'function');
}

/**
 * Resolve lazy stream providers
 * Some libraries return stream providers as functions: () => Readable | Promise<Readable>
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveLazy(input: any): Promise<any> {
  if (typeof input === 'function') {
    return await input();
  }
  return input;
}

/**
 * Read all bytes from various stream/body types
 *
 * Supports:
 * - Web ReadableStream<Uint8Array>
 * - Node.js stream.Readable
 * - Buffer / Uint8Array
 * - ArrayBuffer
 * - Objects with .body, .stream, or .data properties
 * - Functions that return streams (lazy providers)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readAllBytes(input: any): Promise<Uint8Array> {
  // Resolve lazy providers first (functions that return streams)
  input = await resolveLazy(input);

  if (!input) throw new Error('No stream/body provided');

  // Buffer / Uint8Array
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);

  // Web ReadableStream
  if (isWebReadableStream(input)) {
    const reader = input.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  // Node stream.Readable
  if (isNodeReadableStream(input)) {
    const chunks: Buffer[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of Readable.from(input as any)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  // Response-like / wrapper objects
  if (typeof input === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ('body' in input) return readAllBytes((input as any).body);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ('stream' in input) return readAllBytes((input as any).stream);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ('data' in input) return readAllBytes((input as any).data);
  }

  throw new Error(`Unsupported stream/body type: ${Object.prototype.toString.call(input)}`);
}
