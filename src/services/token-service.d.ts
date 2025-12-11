/**
 * Token Management Service
 *
 * Manages token registry in SQLite with user-requested token addition.
 * Provides CRUD operations and metadata caching.
 */
export interface TokenMetadata {
    mint: string;
    chain: string;
    tokenName?: string;
    tokenSymbol?: string;
    addedByUserId?: number;
}
export interface TokenFilters {
    chain?: string;
    addedByUserId?: number;
    createdAfter?: Date;
    createdBefore?: Date;
    search?: string;
}
/**
 * Token Service for managing token registry
 */
export declare class TokenService {
    private db;
    /**
     * Get or create database connection
     */
    private getDatabase;
    /**
     * Ensure tokens table exists
     */
    private ensureTable;
    /**
     * Add a token to the registry (auto-adds if requested by user)
     */
    addToken(mint: string, chain?: string, userId?: number, metadata?: Partial<Pick<TokenMetadata, 'tokenName' | 'tokenSymbol'>>): Promise<TokenMetadata>;
    /**
     * Get token information
     */
    getToken(mint: string, chain?: string): Promise<TokenMetadata | null>;
    /**
     * List tokens with optional filters
     */
    listTokens(filters?: TokenFilters): Promise<TokenMetadata[]>;
    /**
     * Update token metadata
     */
    updateTokenMetadata(mint: string, chain: string, metadata: Partial<Pick<TokenMetadata, 'tokenName' | 'tokenSymbol'>>): Promise<TokenMetadata | null>;
    /**
     * Delete a token from the registry
     */
    deleteToken(mint: string, chain?: string): Promise<boolean>;
    /**
     * Get token count
     */
    getTokenCount(filters?: TokenFilters): Promise<number>;
    /**
     * Close database connection
     */
    close(): Promise<void>;
}
export declare const tokenService: TokenService;
//# sourceMappingURL=token-service.d.ts.map