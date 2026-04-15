import { Hono } from "hono"

import { dashboardAnalyticsRoutes } from "./analytics-route"
import { dashboardBootstrapRoutes } from "./bootstrap-route"
import { dashboardChatRoutes } from "./chat-route"
import { dashboardConfigRoutes } from "./config-route"
import { dashboardConversationsRoutes } from "./conversations-route"
import { dashboardSettingsRoutes } from "./settings-route"

export const dashboardApiRoutes = new Hono()

dashboardApiRoutes.route("/", dashboardConfigRoutes)
dashboardApiRoutes.route("/", dashboardAnalyticsRoutes)
dashboardApiRoutes.route("/", dashboardBootstrapRoutes)
dashboardApiRoutes.route("/", dashboardChatRoutes)
dashboardApiRoutes.route("/", dashboardConversationsRoutes)
dashboardApiRoutes.route("/", dashboardSettingsRoutes)
