export declare class PumpfunLifecycleTracker {
    private ws;
    private readonly processedSignatures;
    private grpcClient;
    private grpcStream;
    private reconnectTimer;
    private readonly yellowstoneUrl?;
    private readonly yellowstoneToken?;
    private readonly useGrpc;
    constructor();
    start(): Promise<void>;
    stop(): void;
    private connectGrpc;
    private buildGrpcSubscription;
    private scheduleReconnect;
    private connectWebSocket;
    private handleLogsNotification;
    private handleGrpcMessage;
    private processLaunch;
    private processGraduation;
    private fetchTransaction;
    private extractPrimaryMint;
    private extractMetadata;
    private isLaunchLog;
    private isGraduationLog;
}
export declare const pumpfunLifecycleTracker: PumpfunLifecycleTracker;
//# sourceMappingURL=pumpfun-lifecycle-tracker.d.ts.map