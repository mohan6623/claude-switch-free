import { Hono } from "hono"

export const dashboardUiRoutes = new Hono()

dashboardUiRoutes.get("/", (c) => {
  return c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>copilot-api dashboard</title>
<link rel="stylesheet" href="/dashboard/app.css" />
</head>
<body>
<main class="layout">
  <header class="header">
    <div class="header-content">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <h1>copilot-api</h1>
      </div>
      <div class="header-status">
        <span class="status-indicator" id="connection-status"></span>
        <button id="refresh-all" class="btn btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Refresh
        </button>
      </div>
    </div>
  </header>

  <div class="dashboard-grid">
    <!-- Insights Panel -->
    <section class="card insights-card">
      <div class="card-header">
        <h2>Insights</h2>
      </div>
      <ul id="insights-list" class="insights-list"></ul>
    </section>

    <!-- Copilot Quota Panel -->
    <section class="card quota-card">
      <div class="card-header">
        <h2>Copilot Quota</h2>
        <span class="badge" id="quota-badge">Loading...</span>
      </div>
      <div id="quota-content" class="quota-grid"></div>
    </section>

    <!-- Model Slots Panel -->
    <section class="card slots-card">
      <div class="card-header">
        <h2>Model Slots</h2>
        <span class="provider-badge" id="provider-badge">-</span>
      </div>
      <div id="slots-grid" class="slots-grid"></div>
    </section>

    <!-- Usage Chart Panel -->
    <section class="card chart-card">
      <div class="card-header">
        <h2>Daily Usage (30 days)</h2>
        <label class="toggle">
          <input type="checkbox" id="group-by-model" />
          <span>Group by model</span>
        </label>
      </div>
      <div id="usage-chart" class="chart-container"></div>
    </section>

    <!-- Model Performance Panel -->
    <section class="card metrics-card">
      <div class="card-header">
        <h2>Model Performance</h2>
      </div>
      <div id="metrics-content" class="metrics-grid"></div>
    </section>

    <!-- Live Request Log Panel -->
    <section class="card logs-card">
      <div class="card-header">
        <h2>Live Request Log</h2>
        <span class="live-badge">
          <span class="live-dot"></span>
          LIVE
        </span>
      </div>
      <div id="logs-container" class="logs-container">
        <div class="logs-placeholder">Connecting...</div>
      </div>
    </section>
  </div>
</main>

<script src="/dashboard/app.js" type="module"></script>
</body>
</html>`)
})

dashboardUiRoutes.get("/app.js", (c) => {
  return c.text(`const SLOT_DEFINITIONS = [
  { id: "defaultModel", label: "Default", icon: "D" },
  { id: "bigModel", label: "Big", icon: "B" },
  { id: "sonnetModel", label: "Sonnet", icon: "S" },
  { id: "haikuModel", label: "Haiku", icon: "H" },
]

const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#a855f7", "#14b8a6"]

const state = {
  groupByModel: false,
  logsIntervalId: undefined,
  logsInFlight: false,
  refreshInFlight: false,
}

const els = {
  insightsList: document.querySelector("#insights-list"),
  quotaBadge: document.querySelector("#quota-badge"),
  quotaContent: document.querySelector("#quota-content"),
  providerBadge: document.querySelector("#provider-badge"),
  slotsGrid: document.querySelector("#slots-grid"),
  usageChart: document.querySelector("#usage-chart"),
  groupByModel: document.querySelector("#group-by-model"),
  metricsContent: document.querySelector("#metrics-content"),
  logsContainer: document.querySelector("#logs-container"),
  connectionStatus: document.querySelector("#connection-status"),
  refreshAll: document.querySelector("#refresh-all"),
}

function setConnectionStatus(isOnline) {
  if (!els.connectionStatus) {
    return
  }

  if (isOnline) {
    els.connectionStatus.classList.add("online")
    return
  }

  els.connectionStatus.classList.remove("online")
}

async function apiFetch(url, options) {
  try {
    const response = await fetch(url, options)

    if (!response.ok) {
      let message = response.statusText || "Request failed"
      try {
        const payload = await response.json()
        const maybeMessage = payload?.error?.message || payload?.message || payload?.error
        if (typeof maybeMessage === "string" && maybeMessage.trim()) {
          message = maybeMessage
        }
      } catch {
        // ignore json parsing errors
      }

      setConnectionStatus(false)
      throw {
        status: response.status,
        message,
      }
    }

    const payload = await response.json()
    setConnectionStatus(true)
    return payload
  } catch (error) {
    setConnectionStatus(false)
    throw error
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(Number(value) || 0)))
}

function formatPercent(value) {
  const safe = Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(100, Math.round(safe)))
}

function makePlaceholder(text) {
  const div = document.createElement("div")
  div.className = "logs-placeholder"
  div.textContent = text
  return div
}

function setLoadingState() {
  if (els.insightsList) {
    els.insightsList.innerHTML = ""
    const item = document.createElement("li")
    item.className = "loading-shimmer"
    els.insightsList.append(item)
  }

  if (els.quotaContent) {
    els.quotaContent.innerHTML = '<div class="loading-shimmer"></div><div class="loading-shimmer"></div><div class="loading-shimmer"></div>'
  }

  if (els.slotsGrid) {
    els.slotsGrid.innerHTML = '<div class="loading-shimmer"></div><div class="loading-shimmer"></div>'
  }

  if (els.usageChart) {
    els.usageChart.innerHTML = '<div class="loading-shimmer" style="height:100%"></div>'
  }

  if (els.metricsContent) {
    els.metricsContent.innerHTML = '<div class="loading-shimmer"></div><div class="loading-shimmer"></div>'
  }

  if (els.logsContainer) {
    els.logsContainer.innerHTML = ""
    els.logsContainer.append(makePlaceholder("Loading recent requests..."))
  }
}

function renderInsights(summary) {
  if (!els.insightsList) {
    return
  }

  els.insightsList.innerHTML = ""

  const insights = Array.isArray(summary?.insights) ? summary.insights : []
  if (insights.length === 0) {
    const empty = document.createElement("li")
    empty.textContent = "No insights yet. Start sending requests to see trends."
    els.insightsList.append(empty)
    return
  }

  for (const insight of insights) {
    const item = document.createElement("li")
    item.textContent = insight
    els.insightsList.append(item)
  }
}

function createMetricCard(value, label) {
  const card = document.createElement("div")
  card.className = "metric-card"

  const valueEl = document.createElement("div")
  valueEl.className = "metric-value"
  valueEl.textContent = value

  const labelEl = document.createElement("div")
  labelEl.className = "metric-label"
  labelEl.textContent = label

  card.append(valueEl, labelEl)
  return card
}

async function loadSummaryPanel() {
  const summary = await apiFetch("/dashboard/api/summary")
  renderInsights(summary)
  return summary
}

function renderQuotaError(message) {
  if (!els.quotaContent || !els.quotaBadge) {
    return
  }

  els.quotaBadge.textContent = "Unavailable"
  els.quotaContent.innerHTML = ""
  const info = document.createElement("div")
  info.className = "logs-placeholder"
  info.textContent = message
  els.quotaContent.append(info)
}

function quotaFillClass(consumedPct) {
  if (consumedPct >= 80) {
    return "danger"
  }

  if (consumedPct >= 50) {
    return "warning"
  }

  return ""
}

function renderQuotaItem(label, detail) {
  const consumedPct = detail.unlimited ? 0 : formatPercent(100 - Number(detail.percent_remaining || 0))

  const wrapper = document.createElement("div")
  wrapper.className = "quota-item"

  const header = document.createElement("div")
  header.className = "quota-header"

  const name = document.createElement("span")
  name.className = "quota-name"
  name.textContent = label

  const value = document.createElement("span")
  value.className = "quota-value"
  if (detail.unlimited) {
    value.textContent = "Unlimited"
  } else {
    value.textContent = formatNumber(detail.remaining || detail.quota_remaining) + " / " + formatNumber(detail.entitlement)
  }

  header.append(name, value)

  const bar = document.createElement("div")
  bar.className = "progress-bar"

  const fill = document.createElement("div")
  fill.className = "progress-fill " + quotaFillClass(consumedPct)
  fill.style.width = consumedPct + "%"

  bar.append(fill)

  const details = document.createElement("div")
  details.className = "quota-details"

  const left = document.createElement("span")
  left.textContent = consumedPct + "% consumed"

  const right = document.createElement("span")
  const overageCount = Number(detail.overage_count || 0)
  right.textContent = overageCount > 0 ? "Overage: " + formatNumber(overageCount) : "No overage"

  details.append(left, right)
  wrapper.append(header, bar, details)
  return wrapper
}

async function loadQuotaPanel() {
  if (!els.quotaContent || !els.quotaBadge) {
    return
  }

  try {
    const payload = await apiFetch("/usage")
    const snapshots = payload?.quota_snapshots

    if (!snapshots) {
      renderQuotaError("No Copilot quota data available.")
      return
    }

    els.quotaBadge.textContent = payload?.copilot_plan || "Copilot"
    els.quotaContent.innerHTML = ""

    els.quotaContent.append(
      renderQuotaItem("Chat", snapshots.chat),
      renderQuotaItem("Completions", snapshots.completions),
      renderQuotaItem("Premium", snapshots.premium_interactions),
    )
  } catch (error) {
    const message = error?.status === 400
      ? "Quota is only available when provider mode is set to Copilot."
      : "Failed to load quota data."

    renderQuotaError(message)
  }
}

function slotLabel(slotId) {
  const entry = SLOT_DEFINITIONS.find((item) => item.id === slotId)
  return entry ? entry.label : slotId
}

function slotIcon(slotId) {
  const entry = SLOT_DEFINITIONS.find((item) => item.id === slotId)
  return entry ? entry.icon : "M"
}

async function updateSlot(select, slotId, model) {
  const previousValue = select.dataset.previousValue || select.value
  select.disabled = true

  try {
    await apiFetch("/dashboard/api/slots/" + slotId, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ model }),
    })

    select.dataset.previousValue = model
  } catch {
    select.value = previousValue
  } finally {
    select.disabled = false
  }
}

function renderSlots(config) {
  if (!els.slotsGrid || !els.providerBadge) {
    return
  }

  els.slotsGrid.innerHTML = ""

  const providerLabel = config?.activeProvider?.label || config?.activeProvider?.id || "Unknown"
  els.providerBadge.textContent = providerLabel

  const slots = config?.slots || {}
  const models = Array.isArray(config?.availableModels) ? config.availableModels : []

  for (const definition of SLOT_DEFINITIONS) {
    const card = document.createElement("div")
    card.className = "slot-card"

    const header = document.createElement("div")
    header.className = "slot-header"

    const icon = document.createElement("div")
    icon.className = "slot-icon"
    icon.textContent = slotIcon(definition.id)

    const name = document.createElement("div")
    name.className = "slot-name"
    name.textContent = slotLabel(definition.id)

    header.append(icon, name)

    const select = document.createElement("select")
    select.className = "slot-select"

    const selectedModel = slots[definition.id] || ""

    for (const model of models) {
      const option = document.createElement("option")
      option.value = model
      option.textContent = model
      option.selected = model === selectedModel
      select.append(option)
    }

    if (models.length === 0) {
      const option = document.createElement("option")
      option.value = ""
      option.textContent = "No models available"
      option.selected = true
      select.append(option)
      select.disabled = true
    } else {
      select.dataset.previousValue = selectedModel
      select.addEventListener("change", () => {
        const nextModel = select.value
        void updateSlot(select, definition.id, nextModel)
      })
    }

    card.append(header, select)
    els.slotsGrid.append(card)
  }
}

async function loadSlotsPanel() {
  const config = await apiFetch("/dashboard/api/config")
  renderSlots(config)
}

function renderChartEmpty(message) {
  if (!els.usageChart) {
    return
  }

  els.usageChart.innerHTML = ""
  els.usageChart.append(makePlaceholder(message))
}

function buildStackedBars(dayRows) {
  const modelKeys = new Set()
  for (const row of dayRows) {
    const byModel = row.byModel || {}
    for (const model of Object.keys(byModel)) {
      modelKeys.add(model)
    }
  }

  return Array.from(modelKeys)
}

function renderUsageChartSvg(dayRows, grouped) {
  if (!els.usageChart) {
    return
  }

  if (!Array.isArray(dayRows) || dayRows.length === 0) {
    renderChartEmpty("No usage data for this period.")
    return
  }

  const width = 1000
  const height = 230
  const marginTop = 10
  const marginBottom = 30
  const marginLeft = 20
  const marginRight = 20
  const chartWidth = width - marginLeft - marginRight
  const chartHeight = height - marginTop - marginBottom

  const maxTokens = Math.max(...dayRows.map((row) => Number(row.totalTokens || 0)), 1)
  const barWidth = chartWidth / dayRows.length

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", "chart-svg")
  svg.setAttribute("viewBox", "0 0 " + width + " " + height)

  const axis = document.createElementNS("http://www.w3.org/2000/svg", "line")
  axis.setAttribute("x1", String(marginLeft))
  axis.setAttribute("x2", String(width - marginRight))
  axis.setAttribute("y1", String(height - marginBottom))
  axis.setAttribute("y2", String(height - marginBottom))
  axis.setAttribute("stroke", "#2a2a3a")
  axis.setAttribute("stroke-width", "1")
  svg.append(axis)

  const modelOrder = grouped ? buildStackedBars(dayRows) : []

  dayRows.forEach((row, index) => {
    const x = marginLeft + index * barWidth
    const totalTokens = Number(row.totalTokens || 0)

    if (grouped && row.byModel && modelOrder.length > 0) {
      let stackCursor = height - marginBottom
      modelOrder.forEach((model, modelIndex) => {
        const modelTokens = Number(row.byModel?.[model]?.totalTokens || 0)
        if (modelTokens <= 0) {
          return
        }

        const segmentHeight = (modelTokens / maxTokens) * chartHeight
        const y = stackCursor - segmentHeight

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
        rect.setAttribute("class", "chart-bar")
        rect.setAttribute("x", String(x + 2))
        rect.setAttribute("y", String(Math.max(marginTop, y)))
        rect.setAttribute("width", String(Math.max(2, barWidth - 4)))
        rect.setAttribute("height", String(Math.max(0, segmentHeight)))
        rect.setAttribute("fill", CHART_COLORS[modelIndex % CHART_COLORS.length])

        const title = document.createElementNS("http://www.w3.org/2000/svg", "title")
        title.textContent = row.date + " - " + model + ": " + formatNumber(modelTokens) + " tokens"
        rect.append(title)

        svg.append(rect)
        stackCursor = y
      })
    } else {
      const barHeight = (totalTokens / maxTokens) * chartHeight
      const y = height - marginBottom - barHeight

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
      rect.setAttribute("class", "chart-bar")
      rect.setAttribute("x", String(x + 2))
      rect.setAttribute("y", String(Math.max(marginTop, y)))
      rect.setAttribute("width", String(Math.max(2, barWidth - 4)))
      rect.setAttribute("height", String(Math.max(0, barHeight)))
      rect.setAttribute("fill", "#6366f1")

      const title = document.createElementNS("http://www.w3.org/2000/svg", "title")
      title.textContent = row.date + ": " + formatNumber(totalTokens) + " tokens"
      rect.append(title)

      svg.append(rect)
    }

    const showLabel = dayRows.length <= 10 || index % Math.ceil(dayRows.length / 8) === 0
    if (showLabel) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text")
      text.setAttribute("x", String(x + barWidth / 2))
      text.setAttribute("y", String(height - 10))
      text.setAttribute("fill", "#8a8a9a")
      text.setAttribute("font-size", "10")
      text.setAttribute("text-anchor", "middle")
      text.textContent = String(row.date).slice(5)
      svg.append(text)
    }
  })

  els.usageChart.innerHTML = ""
  els.usageChart.append(svg)
}

async function loadUsageChart() {
  const query = state.groupByModel ? "?days=30&groupBy=model" : "?days=30"
  const payload = await apiFetch("/dashboard/api/usage/daily" + query)
  renderUsageChartSvg(payload?.days || [], state.groupByModel)
}

function renderPerformance(requests) {
  if (!els.metricsContent) {
    return
  }

  const totalRequests = requests.length
  const okRequests = requests.filter((req) => Number(req.statusCode || 0) < 400).length
  const successRate = totalRequests === 0 ? 0 : (okRequests / totalRequests) * 100
  const avgLatency = totalRequests === 0
    ? 0
    : requests.reduce((sum, req) => sum + Number(req.latencyMs || 0), 0) / totalRequests
  const totalTokens = requests.reduce((sum, req) => sum + Number(req.totalTokens || 0), 0)

  const byModel = new Map()
  for (const req of requests) {
    const model = req.model || "unknown"
    byModel.set(model, (byModel.get(model) || 0) + Number(req.totalTokens || 0))
  }

  const topModel = [...byModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "-"

  els.metricsContent.innerHTML = ""
  els.metricsContent.append(
    createMetricCard(formatPercent(successRate) + "%", "Success Rate"),
    createMetricCard(formatNumber(Math.round(avgLatency)) + "ms", "Avg Latency"),
    createMetricCard(formatNumber(totalTokens), "Recent Tokens"),
    createMetricCard(formatNumber(totalRequests), "Recent Requests"),
    createMetricCard(topModel, "Top Model"),
  )
}

async function loadPerformancePanel() {
  try {
    const payload = await apiFetch("/dashboard/api/requests?limit=200")
    const requests = Array.isArray(payload?.requests) ? payload.requests : []
    renderPerformance(requests)
  } catch {
    if (els.metricsContent) {
      els.metricsContent.innerHTML = ""
      els.metricsContent.append(makePlaceholder("Failed to load performance metrics."))
    }
  }
}

function statusClass(statusCode) {
  const code = Number(statusCode || 0)
  if (code >= 500) {
    return "status-error"
  }
  if (code >= 400) {
    return "status-warning"
  }
  return "status-ok"
}

function renderLogs(requests) {
  if (!els.logsContainer) {
    return
  }

  if (!Array.isArray(requests) || requests.length === 0) {
    els.logsContainer.innerHTML = ""
    els.logsContainer.append(makePlaceholder("No recent requests yet."))
    return
  }

  const table = document.createElement("table")
  table.className = "logs-table"

  const thead = document.createElement("thead")
  const headRow = document.createElement("tr")
  const columns = ["Time", "Route", "Model", "Provider", "Status", "Latency", "Tokens"]

  for (const column of columns) {
    const th = document.createElement("th")
    th.textContent = column
    headRow.append(th)
  }

  thead.append(headRow)

  const tbody = document.createElement("tbody")

  for (const req of requests) {
    const row = document.createElement("tr")
    const time = new Date(req.timestamp).toLocaleTimeString()

    const timeCell = document.createElement("td")
    timeCell.textContent = time

    const routeCell = document.createElement("td")
    routeCell.textContent = req.route || "-"

    const modelCell = document.createElement("td")
    modelCell.textContent = req.model || "-"

    const providerCell = document.createElement("td")
    providerCell.textContent = req.providerId || "-"

    const statusCell = document.createElement("td")
    statusCell.className = statusClass(req.statusCode)
    statusCell.textContent = String(req.statusCode || "-")

    const latencyCell = document.createElement("td")
    latencyCell.textContent = formatNumber(req.latencyMs || 0) + "ms"

    const tokensCell = document.createElement("td")
    tokensCell.textContent = formatNumber(req.totalTokens || 0)

    row.append(timeCell, routeCell, modelCell, providerCell, statusCell, latencyCell, tokensCell)
    tbody.append(row)
  }

  table.append(thead, tbody)
  els.logsContainer.innerHTML = ""
  els.logsContainer.append(table)
}

async function loadLogsPanel() {
  if (state.logsInFlight) {
    return
  }

  state.logsInFlight = true

  try {
    const payload = await apiFetch("/dashboard/api/requests?limit=50")
    const requests = Array.isArray(payload?.requests) ? payload.requests : []
    renderLogs(requests)
  } catch {
    if (els.logsContainer) {
      els.logsContainer.innerHTML = ""
      els.logsContainer.append(makePlaceholder("Failed to load live request stream."))
    }
  } finally {
    state.logsInFlight = false
  }
}

function stopLogsPolling() {
  if (!state.logsIntervalId) {
    return
  }

  clearInterval(state.logsIntervalId)
  state.logsIntervalId = undefined
}

function startLogsPolling() {
  stopLogsPolling()
  if (document.visibilityState !== "visible") {
    return
  }

  state.logsIntervalId = setInterval(() => {
    void loadLogsPanel()
  }, 5000)
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible") {
    startLogsPolling()
    void loadLogsPanel()
    return
  }

  stopLogsPolling()
}

async function refreshAllPanels() {
  if (state.refreshInFlight) {
    return
  }

  state.refreshInFlight = true
  if (els.refreshAll) {
    els.refreshAll.disabled = true
  }

  await Promise.allSettled([
    loadSummaryPanel(),
    loadQuotaPanel(),
    loadSlotsPanel(),
    loadUsageChart(),
    loadPerformancePanel(),
    loadLogsPanel(),
  ])

  if (els.refreshAll) {
    els.refreshAll.disabled = false
  }
  state.refreshInFlight = false
}

function bindEvents() {
  if (els.groupByModel) {
    els.groupByModel.addEventListener("change", () => {
      state.groupByModel = Boolean(els.groupByModel?.checked)
      void loadUsageChart()
    })
  }

  if (els.refreshAll) {
    els.refreshAll.addEventListener("click", () => {
      void refreshAllPanels()
    })
  }

  document.addEventListener("visibilitychange", handleVisibilityChange)
}

async function init() {
  setLoadingState()
  bindEvents()
  await refreshAllPanels()
  startLogsPolling()
}

void init()
`, 200, { "content-type": "application/javascript; charset=utf-8" })
})

dashboardUiRoutes.get("/app.css", (c) => {
  return c.text(`:root {
  --bg: #0a0a0f;
  --surface: #12121a;
  --surface-raised: #1a1a25;
  --border: #2a2a3a;
  --text: #f0f0f5;
  --text-secondary: #8a8a9a;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #3b82f6;
  --radius: 12px;
  --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  min-height: 100vh;
}

.layout { max-width: 1400px; margin: 0 auto; padding: 24px; }

.header {
  margin-bottom: 32px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo svg {
  width: 32px;
  height: 32px;
  color: var(--accent);
}

.logo h1 {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.5px;
}

.header-status {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--error);
}

.status-indicator.online {
  background: var(--success);
  box-shadow: 0 0 8px var(--success);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 20px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.card-header h2 {
  font-size: 16px;
  font-weight: 600;
}

.insights-card { grid-column: 1 / -1; }

.insights-list {
  list-style: none;
  padding: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.insights-list li {
  background: var(--surface-raised);
  padding: 10px 16px;
  border-radius: var(--radius);
  font-size: 14px;
  border-left: 3px solid var(--accent);
}

.badge {
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 20px;
  background: var(--surface-raised);
  color: var(--text-secondary);
}

.provider-badge {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  background: var(--accent);
  color: white;
}

.quota-grid {
  padding: 20px;
  display: grid;
  gap: 16px;
}

.quota-item {
  display: grid;
  gap: 8px;
}

.quota-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.quota-name {
  font-weight: 500;
  font-size: 14px;
}

.quota-value {
  font-size: 13px;
  color: var(--text-secondary);
}

.progress-bar {
  height: 8px;
  background: var(--surface-raised);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--accent-hover));
  border-radius: 4px;
  transition: width 0.5s ease;
}

.progress-fill.warning { background: linear-gradient(90deg, var(--warning), #fbbf24); }
.progress-fill.danger { background: linear-gradient(90deg, var(--error), #f87171); }

.quota-details {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
}

.slots-grid {
  padding: 20px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.slot-card {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}

.slot-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.slot-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.slot-name {
  font-weight: 500;
  font-size: 14px;
}

.slot-select {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.slot-select:focus {
  outline: none;
  border-color: var(--accent);
}

.chart-container {
  padding: 20px;
  height: 250px;
  position: relative;
}

.chart-svg {
  width: 100%;
  height: 100%;
}

.chart-bar {
  transition: opacity 0.2s;
}

.chart-bar:hover {
  opacity: 0.8;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.toggle input {
  accent-color: var(--accent);
}

.metrics-grid {
  padding: 20px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.metric-card {
  background: var(--surface-raised);
  border-radius: var(--radius);
  padding: 16px;
  text-align: center;
}

.metric-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--accent);
}

.metric-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.logs-card { grid-column: 1 / -1; }

.logs-container {
  max-height: 400px;
  overflow-y: auto;
  padding: 16px;
}

.live-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--success);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.logs-table th, .logs-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.logs-table th {
  color: var(--text-secondary);
  font-weight: 500;
  position: sticky;
  top: 0;
  background: var(--surface);
}

.logs-table tr:hover {
  background: var(--surface-raised);
}

.status-ok { color: var(--success); }
.status-error { color: var(--error); }
.status-warning { color: var(--warning); }

.logs-placeholder {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.loading-shimmer {
  background: linear-gradient(90deg, var(--surface-raised) 25%, var(--surface) 50%, var(--surface-raised) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  height: 20px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (max-width: 768px) {
  .dashboard-grid { grid-template-columns: 1fr; }
  .header-content { flex-direction: column; align-items: flex-start; }
  .slots-grid { grid-template-columns: 1fr; }
}
`, 200, { "content-type": "text/css; charset=utf-8" })
})
