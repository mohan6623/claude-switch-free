import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import {
  getAnalyticsSummary,
  getDailyUsage,
  listRecentAnalyticsRequests,
} from "~/lib/analytics-store"

export const dashboardAnalyticsRoutes = new Hono()

dashboardAnalyticsRoutes.get("/requests", async (c) => {
  try {
    const limitRaw = c.req.query("limit")
    const limit = Number(limitRaw || 100)

    const requests = await listRecentAnalyticsRequests(limit)

    return c.json({
      requests,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})

dashboardAnalyticsRoutes.get("/usage/daily", async (c) => {
  try {
    const daysRaw = c.req.query("days")
    const groupBy = c.req.query("groupBy")

    const days = Number(daysRaw || 30)
    const usage = await getDailyUsage({
      days,
      groupByModel: groupBy === "model",
    })

    return c.json(usage)
  } catch (error) {
    return await forwardError(c, error)
  }
})

dashboardAnalyticsRoutes.get("/summary", async (c) => {
  try {
    const summary = await getAnalyticsSummary()
    return c.json(summary)
  } catch (error) {
    return await forwardError(c, error)
  }
})
