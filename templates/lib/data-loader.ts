import type { Alert } from "./types"
import { promises as fs } from "fs"
import path from "path"

export async function loadAlertsFromFile(): Promise<Alert[]> {
  try {
    const filePath = path.join(process.cwd(), "data", "alerts.json")
    const fileContents = await fs.readFile(filePath, "utf8")
    const rawAlerts = JSON.parse(fileContents)

    // Convert timestamp strings to Date objects
    return rawAlerts.map((alert: any) => ({
      ...alert,
      timestamp: new Date(alert.timestamp),
    }))
  } catch (error) {
    console.error("[v0] Error loading alerts from file:", error)
    // Return empty array if file doesn't exist or has errors
    return []
  }
}

export async function saveAlertsToFile(alerts: Alert[]): Promise<void> {
  try {
    const filePath = path.join(process.cwd(), "data", "alerts.json")
    await fs.writeFile(filePath, JSON.stringify(alerts, null, 2), "utf8")
  } catch (error) {
    console.error("[v0] Error saving alerts to file:", error)
    throw error
  }
}
