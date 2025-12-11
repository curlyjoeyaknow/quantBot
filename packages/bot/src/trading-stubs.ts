// Temporary stubs for trading services (to be replaced with real implementation)

export class WalletService {
  async getUserWallets(..._args: any[]): Promise<any[]> {
    return [];
  }
  async getWallet(..._args: any[]): Promise<any | null> {
    return null;
  }
  async getActiveWallet(..._args: any[]): Promise<any | null> {
    return null;
  }
  async getBalance(..._args: any[]): Promise<number> {
    return 0;
  }
}

export class WalletManager {
  async addWallet(..._args: any[]): Promise<any> {
    const name = _args[2] ?? 'wallet';
    return { name, publicKey: 'stub_public_key' };
  }
  async removeWallet(..._args: any[]): Promise<void> {}
}

export class TradingConfigService {
  async enableTrading(..._args: any[]): Promise<void> {}
  async disableTrading(..._args: any[]): Promise<void> {}
  async getConfig(..._args: any[]): Promise<any> {
    return {};
  }
  async upsertConfig(..._args: any[]): Promise<void> {}
  getStatus(..._args: any[]): { isRunning: boolean } {
    return { isRunning: false };
  }
  async addToken(..._args: any[]): Promise<void> {}
}

export class PositionManager {
  async getOpenPositions(..._args: any[]): Promise<any[]> {
    return [];
  }
  async calculatePnL(..._args: any[]): Promise<number> {
    return 0;
  }
  async getPosition(..._args: any[]): Promise<any | null> {
    return null;
  }
}

