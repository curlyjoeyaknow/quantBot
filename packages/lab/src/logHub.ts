export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEvent = {
  ts: string; // ISO timestamp
  level: LogLevel;
  scope: string; // e.g. 'strategies', 'runs', 'duckdb', 'clickhouse'
  msg: string; // human readable
  ctx?: Record<string, unknown>;
  requestId?: string;
  runId?: string;
};

type Subscriber = (e: LogEvent) => void;

export class LogHub {
  private buf: LogEvent[] = [];
  private subs = new Set<Subscriber>();

  constructor(private readonly max = 2000) {}

  emit(e: Omit<LogEvent, 'ts'> & { ts?: string }) {
    const ev: LogEvent = { ts: e.ts ?? new Date().toISOString(), ...e };
    this.buf.push(ev);
    if (this.buf.length > this.max) this.buf.splice(0, this.buf.length - this.max);
    for (const fn of this.subs) fn(ev);
  }

  list(filters?: {
    level?: LogLevel;
    scope?: string;
    q?: string;
    runId?: string;
    requestId?: string;
    limit?: number;
  }): LogEvent[] {
    const limit = Math.max(1, Math.min(filters?.limit ?? 500, 5000));
    let out = this.buf;

    if (filters?.level) out = out.filter((x) => x.level === filters.level);
    if (filters?.scope) out = out.filter((x) => x.scope === filters.scope);
    if (filters?.runId) out = out.filter((x) => x.runId === filters.runId);
    if (filters?.requestId) out = out.filter((x) => x.requestId === filters.requestId);

    if (filters?.q) {
      const q = filters.q.toLowerCase();
      out = out.filter(
        (x) =>
          x.msg.toLowerCase().includes(q) ||
          x.scope.toLowerCase().includes(q) ||
          JSON.stringify(x.ctx ?? {})
            .toLowerCase()
            .includes(q)
      );
    }

    return out.slice(-limit);
  }

  subscribe(fn: Subscriber) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
