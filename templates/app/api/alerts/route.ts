import { NextResponse } from "next/server"
import { loadAlertsFromFile } from "@/lib/data-loader"

export async function GET() {
  const alerts = await loadAlertsFromFile()
  return NextResponse.json(alerts)
}
