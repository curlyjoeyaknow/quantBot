// Script to convert batch simulation results to dashboard alert format

interface SimulationTrade {
  tokenAddress: string
  alertTimestamp: string
  entryPrice: number
  exitPrice?: number
  exitTimestamp?: number
  exitReason?: string
  finalPnLSOL: number
  totalVolumeSOL: number
  isReentry: boolean
  trades: Array<{
    type: string
    entryPrice: number
    exitPrice: number
    pnlSOL: number
    exitReason: string
  }>
}

interface SimulationResults {
  individualTrades: SimulationTrade[]
  strategyName: string
  totalPnLSOL: number
  winRate: number
}

// Read the simulation results from the user's attachment
const simulationData: SimulationResults = {
  strategyName: "batch_api",
  totalPnLSOL: 4.979267890489643,
  winRate: 12.903225806451612,
  individualTrades: [
    // Data from user_read_only_context/text_attachments/batch_simulation_results-xOf8h.json
  ],
}

// Helper to extract token symbol from address (simplified)
function getTokenSymbol(address: string): string {
  const symbols: Record<string, string> = {
    AkuXKTbE8rnYCdpnW8eE1xtKfKfQ3uhwXS3dk9cbpump: "AKU",
    EmNFqmSi5DvwGjW57LJ7J5i8R6T155JrNf6GNFaupump: "EMN",
    "5CxWcsm9h3NfCM8WPM6eaw8LnnSmnYyEHf8BQQ56YJGK": "5CX",
    GexgtHFXNCjtRmehxCR2jo85RoKQpmFNoinKFpw2pump: "GEX",
    ZH4dQL2D7n8biHbxqeYScdmXQ9nYkEPVbHLBQpdVQRu: "ZH4",
    EuzDfT3XVdWXXDV3xfzpUkCsajm3yexr2KyQjsN3pump: "EUZ",
    "48TqCgU8zC2H5tWshNriY2bWHDULSTSvdgL4iP1Fpump": "48T",
    "51YWtFnA97ERyvbxhV6Qoxmkqe3H4g5DCr7P5MUpWiFE": "51Y",
    "4daoTLufDmV3ods48Zh8rymaZKBLtgEvuH9qALYLbonk": "4DAO",
    Bhqya7Tz6a8YAaqCeEz7FDa1Eaaw4Sv5noszGN9Gpump: "BHQ",
    J9gSEVZfJNFoPeMpbTEXAgixjy1Jv2NLmjw9Lkn6pump: "J9G",
    "5o36LjqbSmjk1iYb2M4xVhvpz6nX5BNUKCJU5qJppump": "5O3",
    ERYH7V18RFsXhq7XGbojkpamb5dw6Qyto4kd1Ripump: "ERY",
    "6DEa18xxCgx2SgBTJbFdEY6PTNZMWvG2nDv47LHspump": "6DE",
    "2q4BbT1kZPNCpiNJdFz9zE46ycEwBhkXy6mFDsSabonk": "2Q4",
    FUaEFkijjZ1rsK2S3pNQr5JirJhypN3E5mHKeTHWbonk: "FUA",
    HMcQvSj8hEqdkbyPbEUmiU6mnu5k2Ki5y5J65ebpump: "HMC",
    "2m6cXUkHEpD2KHFovxcdS9uzTKcCbMVav3Yj77mipump": "2M6",
    "4wyFWsArUxww5W7UeV9eX6dyTK9Fcs7jHqdgmtTgpump": "4WY",
    "9JeAxW97KZDyzpCCeq4ycypxmHJYdhnTHXyrc8xKpump": "9JE",
  }
  return symbols[address] || address.slice(0, 6).toUpperCase()
}

function getTokenName(address: string): string {
  return `Token ${getTokenSymbol(address)}`
}

function calculatePnLPercent(entryPrice: number, exitPrice: number): number {
  return ((exitPrice - entryPrice) / entryPrice) * 100
}

function getStatus(exitReason?: string): "active" | "closed" | "stopped" {
  if (!exitReason) return "active"
  if (exitReason.includes("stop_loss")) return "stopped"
  return "closed"
}

// Convert simulation trades to dashboard alerts
const convertedAlerts = simulationData.individualTrades.map((trade, index) => {
  const pnlPercent = trade.exitPrice ? calculatePnLPercent(trade.entryPrice, trade.exitPrice) : 0

  const status = getStatus(trade.exitReason)

  return {
    id: `alert-${String(index + 1).padStart(3, "0")}`,
    timestamp: trade.alertTimestamp,
    creator: "batch_api",
    token: getTokenName(trade.tokenAddress),
    tokenSymbol: getTokenSymbol(trade.tokenAddress),
    tokenAddress: trade.tokenAddress,
    action: "buy" as const,
    confidence: trade.isReentry ? 0.65 : 0.85,
    entryPrice: trade.entryPrice,
    currentPrice: trade.exitPrice || trade.entryPrice,
    exitPrice: trade.exitPrice,
    status,
    pnl: trade.finalPnLSOL,
    pnlPercent,
    exitReason: trade.exitReason,
    isReentry: trade.isReentry,
    volumeSOL: trade.totalVolumeSOL,
    trades: trade.trades,
  }
})

console.log(JSON.stringify(convertedAlerts, null, 2))
