export type NormalizedTelegramMessage = {
    chatId: string;
    messageId: number;
    type: string;
    timestampMs: number;
    fromName: string | null;
    fromId: string | null;
    text: string;
    links: Array<{
        text: string;
        href: string;
    }>;
    replyToMessageId: number | null;
    isService: boolean;
    raw: unknown;
};
export type NormalizeOk = {
    ok: true;
    value: NormalizedTelegramMessage;
};
export type NormalizeErr = {
    ok: false;
    error: {
        code: 'MISSING_ID' | 'BAD_ID' | 'BAD_DATE' | 'UNKNOWN_SHAPE';
        message: string;
    };
    raw: unknown;
};
export declare function normalizeTelegramMessage(input: unknown, chatId: string): NormalizeOk | NormalizeErr;
//# sourceMappingURL=normalize.d.ts.map