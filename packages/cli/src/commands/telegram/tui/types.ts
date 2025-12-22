export type TuiMode = 'all' | 'ok' | 'err';

export type RowBase = {
  key: string;
  chatId: string;
  tsMs: number | null;
  from: string | null;
  preview: string;
  raw: unknown;
};

export type OkRow = RowBase & {
  kind: 'ok';
  messageId: number | null;
  normalized: unknown; // keep flexible; we render safe snapshots
};

export type ErrRow = RowBase & {
  kind: 'err';
  messageId: number | null;
  errorCode: string;
  errorMessage: string;
};

export type Row = OkRow | ErrRow;

export type TelegramTuiOptions = {
  normalizedPath: string;
  quarantinePath: string;
  chatId?: string;
  maxLines?: number;
};
