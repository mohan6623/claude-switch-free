import fs from "node:fs/promises"
import path from "node:path"

import { PATHS } from "~/lib/paths"

const ANALYTICS_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.jsonl$/
const MS_PER_DAY = 24 * 60 * 60 * 1000
const DEFAULT_RETENTION_DAYS = 30

export type AnalyticsTokenSource = "api_usage" | "estimated" | "unknown"

export interface AnalyticsEvent {
  id: string
  timestamp: string
  route: string
  providerId: string
  model: string
  statusCode: number
  latencyMs: number
  stream: boolean
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  tokenSource: AnalyticsTokenSource
}

interface DailyUsageRow {
  date: string
  totalTokens: number
  requestCount: number
  byModel?: Record<string, { totalTokens: number; requestCount: number }>
}

export interface DailyUsageResponse {
  days: Array<DailyUsageRow>
}

export interface SummaryResponse {
  today: {
    totalTokens: number
    requestCount: number
  }
  topModelToday?: {
    model: string
    totalTokens: number
    sharePct: number
  }
  insights: Array<string>
}

export async function recordAnalyticsEvent(
  input: Omit<AnalyticsEvent, "id" | "timestamp">,
): Promise<void> {
  await ensureAnalyticsDir()
  await pruneAnalyticsFiles(DEFAULT_RETENTION_DAYS)

  const now = new Date()
  const event: AnalyticsEvent = {
    id: createEventId(now),
    timestamp: now.toISOString(),
    ...input,
  }

  const filePath = analyticsFilePath(now)
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8")
}

export async function listRecentAnalyticsRequests(
  limit: number = 100,
): Promise<Array<AnalyticsEvent>> {
  await ensureAnalyticsDir()
  await pruneAnalyticsFiles(DEFAULT_RETENTION_DAYS)

  const safeLimit = clamp(limit, 1, 1000)
  const events = await loadEventsForLastDays(DEFAULT_RETENTION_DAYS)

  return events
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, safeLimit)
}

export async function getDailyUsage(
  input?: {
    days?: number
    groupByModel?: boolean
  },
): Promise<DailyUsageResponse> {
  await ensureAnalyticsDir()
  await pruneAnalyticsFiles(DEFAULT_RETENTION_DAYS)

  const days = clamp(input?.days || DEFAULT_RETENTION_DAYS, 1, DEFAULT_RETENTION_DAYS)
  const events = await loadEventsForLastDays(days)
  const groupedByDate = new Map<string, DailyUsageRow>()

  for (const event of events) {
    const date = event.timestamp.slice(0, 10)
    if (!groupedByDate.has(date)) {
      groupedByDate.set(date, {
        date,
        totalTokens: 0,
        requestCount: 0,
        ...(input?.groupByModel ? { byModel: {} } : {}),
      })
    }

    const row = groupedByDate.get(date)
    if (!row) {
      continue
    }

    row.requestCount = row.requestCount + 1
    row.totalTokens = row.totalTokens + (event.totalTokens || 0)

    if (input?.groupByModel) {
      const byModel = row.byModel || {}
      const current = byModel[event.model] || { totalTokens: 0, requestCount: 0 }
      current.totalTokens = current.totalTokens + (event.totalTokens || 0)
      current.requestCount = current.requestCount + 1
      byModel[event.model] = current
      row.byModel = byModel
    }
  }

  return {
    days: [...groupedByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

export async function getAnalyticsSummary(): Promise<SummaryResponse> {
  const today = new Date().toISOString().slice(0, 10)
  const daily = await getDailyUsage({
    days: 30,
    groupByModel: true,
  })

  const todayRow = daily.days.find((row) => row.date === today)

  const totalTokens = todayRow?.totalTokens || 0
  const requestCount = todayRow?.requestCount || 0

  let topModelToday: SummaryResponse["topModelToday"]
  if (todayRow?.byModel) {
    const sorted = Object.entries(todayRow.byModel)
      .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
    const top = sorted[0]
    if (top) {
      topModelToday = {
        model: top[0],
        totalTokens: top[1].totalTokens,
        sharePct: totalTokens > 0 ? Math.round((top[1].totalTokens / totalTokens) * 100) : 0,
      }
    }
  }

  const insights: Array<string> = [
    `Today you used ${formatNumber(totalTokens)} tokens across ${formatNumber(requestCount)} requests.`,
  ]

  if (topModelToday) {
    insights.push(
      `Top model today is ${topModelToday.model} with ${topModelToday.sharePct}% of token usage.`,
    )
  } else {
    insights.push("No model usage data is available for today yet.")
  }

  return {
    today: {
      totalTokens,
      requestCount,
    },
    topModelToday,
    insights,
  }
}

async function loadEventsForLastDays(days: number): Promise<Array<AnalyticsEvent>> {
  const files = await listAnalyticsFiles()
  const cutoff = Date.now() - days * MS_PER_DAY
  const events: Array<AnalyticsEvent> = []

  for (const fileName of files) {
    const parsedDate = parseAnalyticsDate(fileName)
    if (!parsedDate) {
      continue
    }

    if (parsedDate.getTime() + MS_PER_DAY < cutoff) {
      continue
    }

    const filePath = path.join(PATHS.ANALYTICS_DIR, fileName)
    const content = await fs.readFile(filePath, "utf8")
    const lines = content.split("\n").map((line) => line.trim()).filter(Boolean)

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as AnalyticsEvent
        if (typeof parsed.timestamp !== "string") {
          continue
        }
        events.push(parsed)
      } catch {
        // Ignore malformed lines.
      }
    }
  }

  return events
}

async function listAnalyticsFiles(): Promise<Array<string>> {
  try {
    const entries = await fs.readdir(PATHS.ANALYTICS_DIR)

    return entries
      .filter((fileName) => ANALYTICS_FILE_PATTERN.test(fileName))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

async function ensureAnalyticsDir(): Promise<void> {
  await fs.mkdir(PATHS.ANALYTICS_DIR, { recursive: true })
}

async function pruneAnalyticsFiles(retentionDays: number): Promise<void> {
  const files = await listAnalyticsFiles()
  const cutoff = Date.now() - retentionDays * MS_PER_DAY

  for (const fileName of files) {
    const parsedDate = parseAnalyticsDate(fileName)
    if (!parsedDate) {
      continue
    }

    if (parsedDate.getTime() + MS_PER_DAY < cutoff) {
      const filePath = path.join(PATHS.ANALYTICS_DIR, fileName)
      await fs.rm(filePath, { force: true })
    }
  }
}

function parseAnalyticsDate(fileName: string): Date | undefined {
  const base = fileName.replace(/\.jsonl$/, "")
  const parsed = new Date(`${base}T00:00:00.000Z`)

  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function analyticsFilePath(now: Date): string {
  const dayKey = now.toISOString().slice(0, 10)
  return path.join(PATHS.ANALYTICS_DIR, `${dayKey}.jsonl`)
}

function createEventId(now: Date): string {
  return `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)))
}
