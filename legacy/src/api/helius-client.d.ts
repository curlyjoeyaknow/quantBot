export interface AddressTransactionsOptions {
    before?: string;
    limit?: number;
}
export declare class HeliusRestClient {
    private readonly http;
    private readonly apiKey;
    constructor();
    getTransactionsForAddress(address: string, options?: AddressTransactionsOptions): Promise<any[]>;
    getTransactions(signatures: string[]): Promise<any[]>;
}
export declare const heliusRestClient: HeliusRestClient;
//# sourceMappingURL=helius-client.d.ts.map