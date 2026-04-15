import { Hono } from "hono"

import { forwardError } from "~/lib/error"

interface DashboardSettings {
  theme: "system" | "light" | "dark"
  sendKey: "enter" | "ctrlEnter"
  telemetryEnabled: boolean
}

let dashboardSettings: DashboardSettings = {
  theme: "system",
  sendKey: "enter",
  telemetryEnabled: false,
}

export const dashboardSettingsRoutes = new Hono()

dashboardSettingsRoutes.get("/settings", async (c) => {
  try {
    return c.json(dashboardSettings)
  } catch (error) {
    return await forwardError(c, error)
  }
})

dashboardSettingsRoutes.put("/settings", async (c) => {
  try {
    const body = await c.req.json<Partial<DashboardSettings>>()

    dashboardSettings = {
      theme:
        body.theme === "dark" || body.theme === "light" || body.theme === "system"
          ? body.theme
          : dashboardSettings.theme,
      sendKey:
        body.sendKey === "ctrlEnter" || body.sendKey === "enter"
          ? body.sendKey
          : dashboardSettings.sendKey,
      telemetryEnabled:
        typeof body.telemetryEnabled === "boolean"
          ? body.telemetryEnabled
          : dashboardSettings.telemetryEnabled,
    }

    return c.json(dashboardSettings)
  } catch (error) {
    return await forwardError(c, error)
  }
})
