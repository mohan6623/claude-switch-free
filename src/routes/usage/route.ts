import { Hono } from "hono"

import { state } from "~/lib/state"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

export const usageRoute = new Hono()

usageRoute.get("/", async (c) => {
  try {
    if (state.provider.mode !== "copilot") {
      return c.json(
        {
          provider: state.provider.id,
          message:
            "Usage endpoint is only available for Copilot mode. Upstream usage should be checked in your provider dashboard.",
        },
        400,
      )
    }

    const usage = await getCopilotUsage()
    return c.json(usage)
  } catch (error) {
    console.error("Error fetching Copilot usage:", error)
    return c.json({ error: "Failed to fetch Copilot usage" }, 500)
  }
})
