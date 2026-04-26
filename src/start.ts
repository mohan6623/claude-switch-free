#!/usr/bin/env node

import { search as promptSearchSelect } from "@inquirer/prompts"
import { defineCommand } from "citty"
import clipboard from "clipboardy"
import consola from "consola"
import { serve, type ServerHandler } from "srvx"
import invariant from "tiny-invariant"

import {
  buildClaudeSettingsDefaultPromptValue,
  buildClaudeSettingsPromptMessage,
  buildClaudeSettingsSkipMessage,
  inspectClaudeSettingsLocal,
  loadClaudeModelSlotsForTarget,
  syncClaudeSettingsGlobal,
  syncClaudeSettingsLocal,
  syncClaudeSettingsPath,
  type ClaudeSettingsSyncTarget,
} from "./lib/claude-settings"
import { ensurePaths } from "./lib/paths"
import {
  normalizeProviderRequestHandlingMode,
  resolveProviderConfig,
  type ProviderRequestHandlingMode,
  type ResolveProviderOptions,
} from "./lib/provider-config"
import { generateEnvScript } from "./lib/shell"
import {
  decodeRoutedModel,
  encodeRoutedModel,
  summarizeRoutedModel,
} from "./lib/slot-routing"
import {
  clearProviderModelSlots,
  getActiveProviderProfile,
  getProviderProfile,
  loadStartupConfig,
  removeProviderProfile,
  saveStartupConfig,
  setActiveProvider,
  upsertProviderProfile,
  type ProviderProfile,
} from "./lib/startup-config"
import {
  buildProviderDisplayLabel,
  buildSearchStatusLabel,
  buildClaudeModelEnv,
  buildClaudeModelSlotEnv,
  getFeaturedModelCandidates,
  getCopilotModelIds,
  getProviderPresets,
  hasCompleteModelSlots,
  normalizeModelSlots,
  summarizeModelSlots,
  type ModelSlots,
} from "./lib/startup-wizard"
import { state } from "./lib/state"
import { applyModelSlotDraft } from "./lib/switch-model-draft"
import { persistSwitchConfig } from "./lib/switch-persistence"
import { setupCopilotToken, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"
import { server } from "./server"
import { getCopilotToken } from "./services/github/get-copilot-token"

interface RunServerOptions {
  port: number
  verbose: boolean
  accountType: string
  manual: boolean
  rateLimit?: number
  rateLimitWait: boolean
  githubToken?: string
  claudeCode: boolean
  showToken: boolean
  provider?: string
  providerBaseUrl?: string
  providerApiKey?: string
  providerModel?: string
  providerSmallModel?: string
  providerRequestHandlingMode?: string
}

interface StartupSelection {
  providerOptions: ResolveProviderOptions
  modelSlots?: ModelSlots
}

interface ProviderChoice {
  id: string
  label: string
  baseUrl: string
  apiKeyUrl?: string
  isPreset: boolean
  existingProfile?: ProviderProfile
}

interface SearchableOption {
  value: string
  label: string
  description?: string
  searchText?: string
}

interface SwitchSessionSlotSource {
  providerId: string
  path: string
  slots: ModelSlots
}

type PromptSpacing = "major" | "minor" | "none"

const ADD_CUSTOM_PROVIDER_LABEL = "Add custom provider"
const PROVIDER_ACTION_CONTINUE = "Continue with current config"
const PROVIDER_ACTION_ADD = "Add provider"
const PROVIDER_ACTION_UPDATE = "Update provider"
const PROVIDER_ACTION_SWITCH = "Switch configured provider/model"
const PROVIDER_ACTION_DELETE = "Delete provider"
const PROVIDER_ACTION_DELETE_MODELS = "Delete model mappings"
const FALLBACK_MODEL = "qwen/qwen3.6-plus:free"
const DOUBLE_ESCAPE_WINDOW_MS = 850
const DEFAULT_CLAUDE_SETTINGS_SYNC_TARGET: ClaudeSettingsSyncTarget = "local"

class PromptBackError extends Error {
  constructor() {
    super("Prompt back")
    this.name = "PromptBackError"
  }
}

class PromptExitError extends Error {
  constructor() {
    super("Prompt exit")
    this.name = "PromptExitError"
  }
}

let lastPromptCancelAt = 0

async function syncClaudeSettingsFromStartupConfig(
  config: Awaited<ReturnType<typeof loadStartupConfig>>,
  syncTarget: ClaudeSettingsSyncTarget,
): Promise<void> {
  const active = getActiveProviderProfile(config)
  if (!active || !hasCompleteModelSlots(active.modelSlots)) {
    return
  }

  const envPatch = buildClaudeModelSlotEnv(
    normalizeModelSlots(active.modelSlots),
  )

  const result =
    syncTarget === "global" ?
      await syncClaudeSettingsGlobal(envPatch)
    : await syncClaudeSettingsLocal(process.cwd(), envPatch)

  if (result.updated && result.path) {
    consola.info(`Synced Claude settings: ${result.path}`)
    return
  }

  if (syncTarget === "local") {
    consola.warn(
      "No .claude/settings.local.json found to sync from current workspace path.",
    )
  }
}

async function persistSwitchConfigWithTarget(
  config: Awaited<ReturnType<typeof loadStartupConfig>>,
  syncTarget: ClaudeSettingsSyncTarget,
): Promise<void> {
  await persistSwitchConfig({
    config,
    sync: (nextConfig) =>
      syncClaudeSettingsFromStartupConfig(nextConfig, syncTarget),
    save: saveStartupConfig,
  })
}

async function resolveSwitchSessionSlotSource(
  config: Awaited<ReturnType<typeof loadStartupConfig>>,
  syncTarget: ClaudeSettingsSyncTarget,
): Promise<SwitchSessionSlotSource | undefined> {
  const active = getActiveProviderProfile(config)
  if (!active) {
    return undefined
  }

  const loaded = await loadClaudeModelSlotsForTarget(syncTarget, process.cwd())
  if (!loaded) {
    return undefined
  }

  return {
    providerId: active.id,
    path: loaded.path,
    slots: loaded.slots,
  }
}

function resolveDisplayModelSlotsForProfile(
  profile: ProviderProfile,
  slotSource?: SwitchSessionSlotSource,
): ModelSlots | undefined {
  if (slotSource?.providerId === profile.id) {
    return slotSource.slots
  }

  if (!hasCompleteModelSlots(profile.modelSlots)) {
    return undefined
  }

  return normalizeModelSlots(profile.modelSlots)
}

export async function runServer(options: RunServerOptions): Promise<void> {
  await ensurePaths()

  const startupSelection = await resolveStartupSelection(options)

  state.provider = resolveProviderConfig({
    provider: startupSelection.providerOptions.provider,
    providerBaseUrl: startupSelection.providerOptions.providerBaseUrl,
    providerApiKey: startupSelection.providerOptions.providerApiKey,
    providerModel: startupSelection.providerOptions.providerModel,
    providerSmallModel: startupSelection.providerOptions.providerSmallModel,
    providerRequestHandlingMode:
      startupSelection.providerOptions.providerRequestHandlingMode,
  })

  const copilotRouted = hasCopilotRoutedSlot(startupSelection.modelSlots)

  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.accountType = options.accountType
  if (options.accountType !== "individual") {
    consola.info(`Using ${options.accountType} plan GitHub account`)
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait
  state.showToken = options.showToken

  if (state.provider.mode === "copilot" || copilotRouted) {
    await cacheVSCodeVersion()

    if (options.githubToken) {
      state.githubToken = options.githubToken
      consola.info("Using provided GitHub token")
    } else {
      await setupGitHubToken()
    }

    await setupCopilotToken()
  }

  if (state.provider.mode !== "copilot") {
    consola.info(
      `Using provider ${state.provider.id} via ${state.provider.baseUrl}`,
    )

    if (copilotRouted) {
      consola.info("Copilot Pro routing enabled for one or more Claude slots")
    }
  }

  await cacheModels()

  if (state.provider.mode === "openai-compatible") {
    const configuredSlots =
      startupSelection.modelSlots || deriveModelSlotsFromProviderPreferences()

    if (configuredSlots) {
      consola.info(`Configured models: ${summarizeModelSlots(configuredSlots)}`)
    } else {
      consola.info(
        `Configured provider ${state.provider.id}${state.provider.preferredModel ? ` with default=${state.provider.preferredModel}` : ""}`,
      )
    }
  } else if (options.verbose) {
    consola.info(
      `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
    )
  }

  const serverUrl = `http://localhost:${options.port}`

  if (options.claudeCode) {
    invariant(state.models, "Models should be loaded by now")

    const modelOptions = state.models.data.map((model) => model.id)

    const selectedSlots =
      startupSelection.modelSlots
      || normalizeModelSlots({
        defaultModel:
          state.provider.preferredModel || modelOptions[0] || FALLBACK_MODEL,
        bigModel:
          state.provider.preferredModel || modelOptions[0] || FALLBACK_MODEL,
        sonnetModel:
          state.provider.preferredModel || modelOptions[0] || FALLBACK_MODEL,
        haikuModel:
          state.provider.preferredSmallModel
          || state.provider.preferredModel
          || modelOptions[0]
          || FALLBACK_MODEL,
      })

    consola.info(
      `Claude model slots: default=${selectedSlots.defaultModel}, opus=${selectedSlots.bigModel}, sonnet=${selectedSlots.sonnetModel}, haiku=${selectedSlots.haikuModel}`,
    )

    const claudeEnv = buildClaudeModelEnv(serverUrl, selectedSlots)

    const settingsInspection = await inspectClaudeSettingsLocal(process.cwd())

    if (settingsInspection.status === "missing") {
      consola.info(
        `No existing local Claude settings found. A new settings file will be created at ${settingsInspection.path}.`,
      )
    }

    let syncResult: { updated: boolean; path?: string }
    if (settingsInspection.status === "missing") {
      syncResult = await syncClaudeSettingsPath(
        settingsInspection.path,
        claudeEnv,
      )
    } else if (
      settingsInspection.status === "loaded"
      && settingsInspection.hasUnrelatedSettings
    ) {
      const shouldMerge = await promptConfirm(
        buildClaudeSettingsPromptMessage(settingsInspection),
        buildClaudeSettingsDefaultPromptValue(settingsInspection),
      )

      if (!shouldMerge) {
        consola.warn(buildClaudeSettingsSkipMessage(settingsInspection))
        syncResult = { updated: false }
      } else {
        syncResult = await syncClaudeSettingsPath(
          settingsInspection.path,
          claudeEnv,
        )
      }
    } else if (settingsInspection.status === "invalid-json") {
      const shouldOverwrite = await promptConfirm(
        buildClaudeSettingsPromptMessage(settingsInspection),
        buildClaudeSettingsDefaultPromptValue(settingsInspection),
      )

      if (!shouldOverwrite) {
        consola.warn(buildClaudeSettingsSkipMessage(settingsInspection))
        syncResult = { updated: false }
      } else {
        syncResult = await syncClaudeSettingsPath(
          settingsInspection.path,
          claudeEnv,
        )
      }
    } else {
      syncResult = await syncClaudeSettingsLocal(process.cwd(), claudeEnv)
    }

    if (syncResult.updated && syncResult.path) {
      consola.info(`Synced Claude settings: ${syncResult.path}`)
    }

    const command = generateEnvScript(claudeEnv, "claude")

    try {
      clipboard.writeSync(command)
      consola.success("Copied Claude Code command to clipboard!")
    } catch {
      consola.warn(
        "Failed to copy to clipboard. Here is the Claude Code command:",
      )
      consola.log(command)
    }
  }

  consola.box(`Dashboard: ${serverUrl}/dashboard`)

  serve({
    fetch: server.fetch as ServerHandler,
    port: options.port,
  })
}

async function resolveStartupSelection(
  options: RunServerOptions,
): Promise<StartupSelection> {
  if (hasExplicitProviderConfiguration(options) || !process.stdin.isTTY) {
    return {
      providerOptions: {
        provider: options.provider,
        providerBaseUrl: options.providerBaseUrl,
        providerApiKey: options.providerApiKey,
        providerModel: options.providerModel,
        providerSmallModel: options.providerSmallModel,
        providerRequestHandlingMode: options.providerRequestHandlingMode,
      },
    }
  }

  const savedSelection = await resolveSavedStartupSelection()
  if (savedSelection) {
    return savedSelection
  }

  return {
    providerOptions: {
      provider: "copilot",
    },
  }
}

async function resolveSavedStartupSelection(): Promise<
  StartupSelection | undefined
> {
  const startupConfig = await loadStartupConfig()
  const active = getActiveProviderProfile(startupConfig)

  if (!active) {
    return undefined
  }

  if (hasCompleteModelSlots(active.modelSlots)) {
    return buildSelectionFromProfile(
      active,
      normalizeModelSlots(active.modelSlots),
    )
  }

  return {
    providerOptions: {
      provider: active.isPreset ? active.id : "custom",
      providerBaseUrl: active.baseUrl,
      providerApiKey: active.apiKey,
      providerRequestHandlingMode: active.requestHandlingMode,
    },
  }
}

export async function runSwitchConfiguration(): Promise<void> {
  await ensurePaths()

  let syncTarget: ClaudeSettingsSyncTarget
  try {
    syncTarget = await promptClaudeSettingsSyncTarget(
      DEFAULT_CLAUDE_SETTINGS_SYNC_TARGET,
    )
  } catch (error) {
    if (error instanceof PromptBackError || error instanceof PromptExitError) {
      return
    }

    throw error
  }

  consola.info(
    `Claude settings sync target: ${describeClaudeSettingsSyncTarget(syncTarget)}`,
  )

  let workingConfig = await loadStartupConfig()

  if (workingConfig.providers.length === 0) {
    consola.warn(
      "No providers configured yet. Add a provider first in switch mode.",
    )
    let added: StartupSelection
    try {
      added = await runAddProviderFlow(workingConfig, syncTarget)
    } catch (error) {
      if (
        error instanceof PromptBackError
        || error instanceof PromptExitError
      ) {
        return
      }

      throw error
    }
    workingConfig = await loadStartupConfig()
    consola.info(
      `Initialized with provider ${added.providerOptions.provider || "custom"}`,
    )
  }

  const sessionSlotSource = await resolveSwitchSessionSlotSource(
    workingConfig,
    syncTarget,
  )

  if (sessionSlotSource) {
    consola.info(
      `Loaded slot models from ${sessionSlotSource.path}: ${summarizeModelSlots(sessionSlotSource.slots)}`,
    )
  } else if (getActiveProviderProfile(workingConfig)) {
    const targetLabel = syncTarget === "global" ? "global" : "local"
    consola.warn(
      `No slot models found in selected ${targetLabel} Claude settings file. Falling back to startup-config slot values.`,
    )
  }

  let dirty = false

  while (true) {
    const active = getActiveProviderProfile(workingConfig)
    const activeLabel = active ? `${active.label} (${active.id})` : "none"

    let action: string
    try {
      action = await promptSelect(
        `Switch configuration mode (active provider: ${activeLabel})`,
        [
          PROVIDER_ACTION_CONTINUE,
          PROVIDER_ACTION_ADD,
          PROVIDER_ACTION_UPDATE,
          PROVIDER_ACTION_SWITCH,
          "Change model mappings",
          PROVIDER_ACTION_DELETE_MODELS,
          PROVIDER_ACTION_DELETE,
          "Save and exit",
          "Exit",
        ],
        PROVIDER_ACTION_CONTINUE,
        { spacing: "major" },
      )
    } catch (error) {
      if (error instanceof PromptBackError) {
        continue
      }

      if (error instanceof PromptExitError) {
        if (!dirty) {
          return
        }

        const exitDecision = await promptSelect(
          "Unsaved changes detected. What do you want to do?",
          ["Save changes and exit", "Discard changes and exit", "Back"],
          "Back",
          { spacing: "minor" },
        )

        if (exitDecision === "Save changes and exit") {
          await persistSwitchConfigWithTarget(workingConfig, syncTarget)
          consola.success("Saved switch configuration.")
          return
        }

        if (exitDecision === "Discard changes and exit") {
          consola.info("Discarded unsaved switch changes.")
          return
        }

        continue
      }

      throw error
    }

    if (action === "Change model mappings") {
      let result
      try {
        result = await runChangeModelDraft(workingConfig, sessionSlotSource)
      } catch (error) {
        if (error instanceof PromptBackError) {
          continue
        }

        if (error instanceof PromptExitError) {
          if (!dirty) {
            return
          }

          const exitDecision = await promptSelect(
            "Unsaved changes detected. What do you want to do?",
            ["Save changes and exit", "Discard changes and exit", "Back"],
            "Back",
            { spacing: "minor" },
          )

          if (exitDecision === "Save changes and exit") {
            await persistSwitchConfigWithTarget(workingConfig, syncTarget)
            consola.success("Saved switch configuration.")
            return
          }

          if (exitDecision === "Discard changes and exit") {
            consola.info("Discarded unsaved switch changes.")
            return
          }

          continue
        }

        throw error
      }

      workingConfig = result.updatedConfig
      dirty = dirty || result.changed
      continue
    }

    if (action === PROVIDER_ACTION_CONTINUE) {
      try {
        await runContinueProviderFlow(
          workingConfig,
          syncTarget,
          sessionSlotSource,
        )
      } catch (error) {
        if (error instanceof PromptBackError) {
          continue
        }

        throw error
      }
      workingConfig = await loadStartupConfig()
      dirty = false
      continue
    }

    if (action === PROVIDER_ACTION_ADD) {
      try {
        await runAddProviderFlow(workingConfig, syncTarget)
      } catch (error) {
        if (error instanceof PromptBackError) {
          continue
        }

        throw error
      }
      workingConfig = await loadStartupConfig()
      dirty = false
      continue
    }

    if (action === PROVIDER_ACTION_UPDATE) {
      try {
        await runUpdateProviderFlow(
          workingConfig,
          syncTarget,
          undefined,
          sessionSlotSource,
        )
      } catch (error) {
        if (error instanceof PromptBackError) {
          continue
        }

        throw error
      }
      workingConfig = await loadStartupConfig()
      dirty = false
      continue
    }

    if (action === PROVIDER_ACTION_SWITCH) {
      try {
        await runSwitchProviderFlow(
          workingConfig,
          syncTarget,
          sessionSlotSource,
        )
      } catch (error) {
        if (error instanceof PromptBackError) {
          continue
        }

        throw error
      }
      workingConfig = await loadStartupConfig()
      dirty = false
      continue
    }

    if (action === PROVIDER_ACTION_DELETE_MODELS) {
      try {
        await runDeleteModelMappingsFlow(
          workingConfig,
          syncTarget,
          sessionSlotSource,
        )
      } catch (error) {
        if (error instanceof PromptBackError) {
          continue
        }

        throw error
      }
      workingConfig = await loadStartupConfig()
      dirty = false
      continue
    }

    if (action === PROVIDER_ACTION_DELETE) {
      try {
        await runDeleteProviderFlow(
          workingConfig,
          syncTarget,
          sessionSlotSource,
        )
      } catch (error) {
        if (error instanceof PromptBackError) {
          continue
        }

        throw error
      }
      workingConfig = await loadStartupConfig()
      dirty = false

      if (workingConfig.providers.length === 0) {
        consola.warn(
          "No providers configured yet. Add a provider first in switch mode.",
        )
        let added: StartupSelection
        try {
          added = await runAddProviderFlow(workingConfig, syncTarget)
        } catch (error) {
          if (error instanceof PromptBackError) {
            continue
          }

          throw error
        }
        workingConfig = await loadStartupConfig()
        consola.info(
          `Initialized with provider ${added.providerOptions.provider || "custom"}`,
        )
      }

      continue
    }

    if (action === "Save and exit") {
      if (dirty) {
        await persistSwitchConfigWithTarget(workingConfig, syncTarget)
        consola.success("Saved switch configuration.")
      } else {
        consola.info("No changes to save.")
      }
      return
    }

    if (!dirty) {
      return
    }

    const exitDecision = await promptSelect(
      "Unsaved changes detected. What do you want to do?",
      ["Save changes and exit", "Discard changes and exit", "Back"],
      "Back",
      { spacing: "minor" },
    )

    if (exitDecision === "Save changes and exit") {
      await persistSwitchConfigWithTarget(workingConfig, syncTarget)
      consola.success("Saved switch configuration.")
      return
    }

    if (exitDecision === "Discard changes and exit") {
      consola.info("Discarded unsaved switch changes.")
      return
    }
  }
}

async function runChangeModelDraft(
  startupConfig: Awaited<ReturnType<typeof loadStartupConfig>>,
  slotSource?: SwitchSessionSlotSource,
): Promise<{
  updatedConfig: Awaited<ReturnType<typeof loadStartupConfig>>
  activeProfile: ProviderProfile
  modelSlots: ModelSlots
  changed: boolean
}> {
  const active = getActiveProviderProfile(startupConfig)
  if (!active) {
    throw new Error(
      "No active provider found. Add a provider before changing model slots.",
    )
  }

  let modelSlots =
    resolveDisplayModelSlotsForProfile(active, slotSource)
    || normalizeModelSlots({
      defaultModel:
        active.id === "openrouter" ? "qwen/qwen3.6-plus:free" : FALLBACK_MODEL,
      bigModel:
        active.id === "openrouter" ? "qwen/qwen3.6-plus:free" : FALLBACK_MODEL,
      sonnetModel:
        active.id === "openrouter" ? "qwen/qwen3.6-plus:free" : FALLBACK_MODEL,
      haikuModel:
        active.id === "openrouter" ? "qwen/qwen3.6-plus:free" : FALLBACK_MODEL,
    })

  let updatedSlots = { ...modelSlots }
  let didChange = false

  while (true) {
    let slotSelection: string
    try {
      slotSelection = await promptSelect(
        "Select slot to change",
        [
          `default (${summarizeRoutedModel(updatedSlots.defaultModel)})`,
          `opus (${summarizeRoutedModel(updatedSlots.bigModel)})`,
          `sonnet (${summarizeRoutedModel(updatedSlots.sonnetModel)})`,
          `haiku (${summarizeRoutedModel(updatedSlots.haikuModel)})`,
          "Save changes and return",
          "Discard changes and return",
        ],
        "Save changes and return",
        { spacing: "major" },
      )
    } catch (error) {
      if (error instanceof PromptBackError) {
        return {
          updatedConfig: startupConfig,
          activeProfile: active,
          modelSlots,
          changed: false,
        }
      }
      throw error
    }

    if (slotSelection === "Discard changes and return") {
      return {
        updatedConfig: startupConfig,
        activeProfile: active,
        modelSlots,
        changed: false,
      }
    }

    if (slotSelection === "Save changes and return") {
      break
    }

    const slot = parseSlotLabel(slotSelection)
    const currentValue = getSlotModel(updatedSlots, slot)
    const currentRoute = decodeRoutedModel(currentValue)

    let selectedProviderId: string
    try {
      selectedProviderId = await promptSlotProvider(
        startupConfig.providers,
        currentRoute?.providerId || active.id,
      )
    } catch (error) {
      if (error instanceof PromptBackError) {
        continue
      }
      throw error
    }

    let selectedModel: string
    try {
      selectedModel = await promptModelForProviderSlot(
        startupConfig,
        selectedProviderId,
        currentRoute?.model || currentValue,
        slot,
      )
    } catch (error) {
      if (error instanceof PromptBackError) {
        continue
      }
      throw error
    }

    const nextValue = encodeRoutedModel(selectedProviderId, selectedModel)
    if (getSlotModel(updatedSlots, slot) !== nextValue) {
      updatedSlots = setSlotModel(updatedSlots, slot, nextValue)
      didChange = true
    }
  }

  if (!didChange) {
    return {
      updatedConfig: startupConfig,
      activeProfile: active,
      modelSlots,
      changed: false,
    }
  }

  modelSlots = normalizeModelSlots(updatedSlots)
  const updatedConfig = applyModelSlotDraft(startupConfig, active, modelSlots)
  const activeProfile = getProviderProfile(updatedConfig, active.id)

  if (!activeProfile) {
    throw new Error("Unable to persist model slot draft for active provider")
  }

  return {
    updatedConfig,
    activeProfile,
    modelSlots,
    changed: true,
  }
}

async function promptSlotProvider(
  profiles: Array<ProviderProfile>,
  initialProviderId: string,
): Promise<string> {
  const providerOptions: Array<SearchableOption> = [
    {
      value: "copilot",
      label: "Copilot Pro",
      description: "OAuth-backed GitHub Copilot provider",
      searchText: "copilot github",
    },
    ...[...profiles]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((profile) => ({
        value: profile.id,
        label: buildProviderDisplayLabel({
          label: profile.label,
          baseUrl: profile.baseUrl,
        }),
        description: profile.baseUrl,
        searchText: `${profile.id} ${profile.label} ${profile.baseUrl}`,
      })),
  ]

  return await promptSelect(
    "Search provider for slot",
    providerOptions,
    providerOptions.some((option) => option.value === initialProviderId) ?
      initialProviderId
    : providerOptions[0]?.value,
    { spacing: "minor" },
  )
}

async function promptModelForProviderSlot(
  startupConfig: Awaited<ReturnType<typeof loadStartupConfig>>,
  providerId: string,
  initialModel: string,
  slot: "default" | "opus" | "sonnet" | "haiku",
): Promise<string> {
  if (providerId === "copilot") {
    const copilotModels = await fetchCopilotModelsForSlotSelection()
    if (copilotModels.length > 0) {
      return await promptModelFromSearch(
        `Copilot Pro ${slot} model`,
        copilotModels,
        initialModel,
      )
    }

    consola.warn(
      "Could not load Copilot Pro models. Falling back to manual model entry.",
    )
    return await promptText(`Enter Copilot model for ${slot}`, initialModel)
  }

  const profile = startupConfig.providers.find((item) => item.id === providerId)
  if (!profile) {
    throw new Error(`Provider ${providerId} is not configured`)
  }

  const availableModels = await fetchProviderModels(
    profile.id,
    profile.baseUrl,
    profile.apiKey,
  )
  if (availableModels.length === 0) {
    return await promptText(`Enter model id for ${slot}`, initialModel)
  }

  return await promptModelFromSearch(
    `${slot} model`,
    availableModels,
    initialModel,
  )
}

async function fetchCopilotModelsForSlotSelection(): Promise<Array<string>> {
  if (state.models?.data?.length) {
    return getCopilotModelIds(state.models)
  }

  const previousProvider = state.provider

  try {
    state.provider = {
      id: "copilot",
      mode: "copilot",
    }

    if (!state.vsCodeVersion) {
      await cacheVSCodeVersion()
    }

    if (!state.githubToken) {
      await setupGitHubToken()
    }

    if (!state.copilotToken) {
      const { token } = await getCopilotToken()
      state.copilotToken = token
    }

    await cacheModels()
    return getCopilotModelIds(state.models)
  } catch (error) {
    consola.warn(
      "Failed to load Copilot Pro model list for slot selection.",
      error,
    )
    return []
  } finally {
    state.provider = previousProvider
  }
}

async function runContinueProviderFlow(
  startupConfig: Awaited<ReturnType<typeof loadStartupConfig>>,
  syncTarget: ClaudeSettingsSyncTarget,
  slotSource?: SwitchSessionSlotSource,
): Promise<StartupSelection> {
  const active = getActiveProviderProfile(startupConfig)

  if (!active) {
    return await runAddProviderFlow(startupConfig, syncTarget)
  }

  const withActive = setActiveProvider(startupConfig, active.id)
  await persistSwitchConfigWithTarget(withActive, syncTarget)

  const modelSlots = resolveDisplayModelSlotsForProfile(active, slotSource)

  if (!modelSlots) {
    const fallbackSlots = buildDefaultModelSlotsForProvider(active.id)
    const updatedProfile: ProviderProfile = {
      ...active,
      modelSlots: fallbackSlots,
      updatedAt: new Date().toISOString(),
    }

    const updatedConfig = setActiveProvider(
      upsertProviderProfile(withActive, updatedProfile),
      updatedProfile.id,
    )
    await persistSwitchConfigWithTarget(updatedConfig, syncTarget)

    consola.warn(
      `Provider ${active.label} had no model slots. Default mappings were created; use \"Change model mappings\" to customize.`,
    )

    return buildSelectionFromProfile(updatedProfile, fallbackSlots)
  }

  consola.info(`Continuing with ${active.label} (${active.baseUrl})`)
  consola.info(
    `Request handling mode: ${formatRequestHandlingModeLabel(active.requestHandlingMode)}`,
  )
  consola.info(`Selected models: ${summarizeModelSlots(modelSlots)}`)

  return buildSelectionFromProfile(active, modelSlots)
}

async function runAddProviderFlow(
  startupConfig: Awaited<ReturnType<typeof loadStartupConfig>>,
  syncTarget: ClaudeSettingsSyncTarget,
): Promise<StartupSelection> {
  const providerChoice = await promptProviderChoiceForAdd(
    startupConfig.providers,
  )
  const apiKey = await promptProviderApiKey(providerChoice)
  const requestHandlingMode = await promptRequestHandlingMode(
    providerChoice.existingProfile?.requestHandlingMode,
  )

  const modelSlots =
    hasCompleteModelSlots(providerChoice.existingProfile?.modelSlots) ?
      normalizeModelSlots(providerChoice.existingProfile.modelSlots)
    : buildDefaultModelSlotsForProvider(providerChoice.id)

  const updatedProfile: ProviderProfile = {
    id: providerChoice.id,
    label: providerChoice.label,
    baseUrl: providerChoice.baseUrl,
    apiKey,
    apiKeyUrl: providerChoice.apiKeyUrl,
    isPreset: providerChoice.isPreset,
    requestHandlingMode,
    modelSlots,
    updatedAt: new Date().toISOString(),
  }

  const updatedConfig = setActiveProvider(
    upsertProviderProfile(startupConfig, updatedProfile),
    updatedProfile.id,
  )
  await persistSwitchConfigWithTarget(updatedConfig, syncTarget)

  consola.info(
    `Request handling mode: ${formatRequestHandlingModeLabel(requestHandlingMode)}`,
  )
  consola.info(
    'Provider added. Use "Change model mappings" when you want to update slot models.',
  )
  consola.info(`Current model mappings: ${summarizeModelSlots(modelSlots)}`)
  return buildSelectionFromProfile(updatedProfile, modelSlots)
}

async function runUpdateProviderFlow(
  startupConfig: Awaited<ReturnType<typeof loadStartupConfig>>,
  syncTarget: ClaudeSettingsSyncTarget,
  providerId?: string,
  slotSource?: SwitchSessionSlotSource,
): Promise<StartupSelection> {
  const profile =
    providerId ?
      startupConfig.providers.find((provider) => provider.id === providerId)
    : await promptExistingProviderProfile(
        startupConfig.providers,
        "Search provider to update",
        slotSource,
      )

  if (!profile) {
    throw new Error("No provider available to update")
  }

  const updateOptions = [
    "Update API key",
    "Update request handling mode",
    "Update API key and request handling mode",
    "Back",
  ]

  const updateSelection = await promptSelect(
    "What do you want to update?",
    updateOptions,
    updateOptions[0],
    { spacing: "minor" },
  )

  if (updateSelection === "Back") {
    throw new PromptBackError()
  }

  const shouldUpdateApiKey =
    updateSelection === "Update API key"
    || updateSelection === "Update API key and model slots"
    || updateSelection === "Update everything"
  const shouldUpdateRequestHandlingMode =
    updateSelection === "Update request handling mode"
    || updateSelection === "Update API key and request handling mode"

  const apiKey =
    shouldUpdateApiKey ?
      await promptProviderApiKey({
        id: profile.id,
        label: profile.label,
        baseUrl: profile.baseUrl,
        apiKeyUrl: profile.apiKeyUrl,
        isPreset: profile.isPreset,
        existingProfile: profile,
      })
    : profile.apiKey

  const modelSlots =
    hasCompleteModelSlots(profile.modelSlots) ?
      normalizeModelSlots(profile.modelSlots)
    : buildDefaultModelSlotsForProvider(profile.id)

  const requestHandlingMode =
    shouldUpdateRequestHandlingMode ?
      await promptRequestHandlingMode(profile.requestHandlingMode)
    : normalizeProviderRequestHandlingMode(profile.requestHandlingMode)

  const updatedProfile: ProviderProfile = {
    ...profile,
    apiKey,
    requestHandlingMode,
    modelSlots,
    updatedAt: new Date().toISOString(),
  }

  const updatedConfig = setActiveProvider(
    upsertProviderProfile(startupConfig, updatedProfile),
    updatedProfile.id,
  )
  await persistSwitchConfigWithTarget(updatedConfig, syncTarget)

  consola.info(
    `Request handling mode: ${formatRequestHandlingModeLabel(requestHandlingMode)}`,
  )
  consola.info(
    'Provider metadata updated. Slot model changes remain in "Change model mappings".',
  )
  consola.info(`Current model mappings: ${summarizeModelSlots(modelSlots)}`)
  return buildSelectionFromProfile(updatedProfile, modelSlots)
}

async function runSwitchProviderFlow(
  startupConfig: Awaited<ReturnType<typeof loadStartupConfig>>,
  syncTarget: ClaudeSettingsSyncTarget,
  slotSource?: SwitchSessionSlotSource,
): Promise<StartupSelection> {
  const selectedProfile = await promptExistingProviderProfile(
    startupConfig.providers,
    "Search configured provider/model",
    slotSource,
  )

  if (!selectedProfile) {
    throw new Error("No configured provider found")
  }

  let modelSlots: ModelSlots
  modelSlots =
    hasCompleteModelSlots(selectedProfile.modelSlots) ?
      normalizeModelSlots(selectedProfile.modelSlots)
    : buildDefaultModelSlotsForProvider(selectedProfile.id)

  const refreshedProfile: ProviderProfile = {
    ...selectedProfile,
    modelSlots,
    updatedAt: new Date().toISOString(),
  }

  const updatedConfig = setActiveProvider(
    upsertProviderProfile(startupConfig, refreshedProfile),
    refreshedProfile.id,
  )
  await persistSwitchConfigWithTarget(updatedConfig, syncTarget)

  consola.info(`Selected models: ${summarizeModelSlots(modelSlots)}`)
  return buildSelectionFromProfile(refreshedProfile, modelSlots)
}

async function runDeleteModelMappingsFlow(
  startupConfig: Awaited<ReturnType<typeof loadStartupConfig>>,
  syncTarget: ClaudeSettingsSyncTarget,
  slotSource?: SwitchSessionSlotSource,
): Promise<void> {
  const profile = await promptExistingProviderProfile(
    startupConfig.providers,
    "Search provider model mappings to delete",
    slotSource,
  )

  if (!profile) {
    throw new Error("No configured provider found")
  }

  if (!hasCompleteModelSlots(profile.modelSlots)) {
    consola.warn(
      `Provider ${profile.label} has no saved model mappings to delete.`,
    )
    return
  }

  const confirmed = await promptConfirm(
    `Delete all model slot mappings for ${profile.label}?`,
    false,
  )

  if (!confirmed) {
    consola.info("Model mapping deletion cancelled.")
    return
  }

  const updatedConfig = clearProviderModelSlots(startupConfig, profile.id)
  await persistSwitchConfigWithTarget(updatedConfig, syncTarget)
  consola.success(`Deleted model mappings for ${profile.label}.`)
}

async function runDeleteProviderFlow(
  startupConfig: Awaited<ReturnType<typeof loadStartupConfig>>,
  syncTarget: ClaudeSettingsSyncTarget,
  slotSource?: SwitchSessionSlotSource,
): Promise<void> {
  const profile = await promptExistingProviderProfile(
    startupConfig.providers,
    "Search provider to delete",
    slotSource,
  )

  if (!profile) {
    throw new Error("No configured provider found")
  }

  const confirmed = await promptConfirm(
    `Delete provider ${profile.label} and remove its API key + model configuration?`,
    false,
  )

  if (!confirmed) {
    consola.info("Provider deletion cancelled.")
    return
  }

  const updatedConfig = removeProviderProfile(startupConfig, profile.id)
  await persistSwitchConfigWithTarget(updatedConfig, syncTarget)

  const nextActive = getActiveProviderProfile(updatedConfig)
  consola.success(`Deleted provider ${profile.label} (${profile.id}).`)

  if (nextActive) {
    consola.info(
      `Active provider is now ${nextActive.label} (${nextActive.id}).`,
    )
  } else {
    consola.warn("No providers remain configured.")
  }
}

async function promptProviderChoiceForAdd(
  existingProfiles: Array<ProviderProfile>,
): Promise<ProviderChoice> {
  const presets = getProviderPresets()

  const options: Array<SearchableOption | string> = [
    ...presets.map((preset) => ({
      value: `preset:${preset.id}`,
      label: buildProviderDisplayLabel({
        label: preset.label,
        baseUrl: preset.baseUrl,
      }),
      description: "Preset provider",
      searchText: `${preset.id} ${preset.label} ${preset.baseUrl}`,
    })),
    ADD_CUSTOM_PROVIDER_LABEL,
    "Back",
  ]

  const selected = await promptSelect(
    "Search provider profile",
    options,
    presets[0] ? `preset:${presets[0].id}` : ADD_CUSTOM_PROVIDER_LABEL,
    { spacing: "major" },
  )

  if (selected === ADD_CUSTOM_PROVIDER_LABEL) {
    const customProviderName = await promptText("Enter custom provider name")
    const customBaseUrl = stripBaseUrl(
      await promptText("Enter custom provider base URL"),
    )

    const customId = buildCustomProviderId(customProviderName, customBaseUrl)
    const existingProfile = getProviderProfile(
      { version: 1, providers: existingProfiles },
      customId,
    )

    return {
      id: customId,
      label: customProviderName,
      baseUrl: customBaseUrl,
      isPreset: false,
      existingProfile,
    }
  }

  if (selected === "Back") {
    throw new PromptBackError()
  }

  const presetValuePrefix = "preset:"
  if (selected.startsWith(presetValuePrefix)) {
    const presetId = selected.slice(presetValuePrefix.length)
    const preset = presets.find((item) => item.id === presetId)

    if (!preset) {
      throw new Error(`Unable to resolve preset "${presetId}"`)
    }

    return {
      id: preset.id,
      label: preset.label,
      baseUrl: preset.baseUrl,
      apiKeyUrl: preset.apiKeyUrl,
      isPreset: true,
      existingProfile: getProviderProfile(
        { version: 1, providers: existingProfiles },
        preset.id,
      ),
    }
  }

  throw new Error(`Unsupported provider option "${selected}"`)
}

async function promptExistingProviderProfile(
  profiles: Array<ProviderProfile>,
  promptMessage: string,
  slotSource?: SwitchSessionSlotSource,
): Promise<ProviderProfile | undefined> {
  if (profiles.length === 0) {
    return undefined
  }

  const options: Array<SearchableOption> = profiles.map((profile) => {
    const displaySlots = resolveDisplayModelSlotsForProfile(profile, slotSource)
    const slotSummary =
      displaySlots ?
        summarizeModelSlotsForList(displaySlots)
      : "models not configured"
    const requestMode = formatRequestHandlingModeLabel(
      profile.requestHandlingMode,
    )

    return {
      value: profile.id,
      label: buildProviderDisplayLabel({
        label: profile.label,
        baseUrl: profile.baseUrl,
        isActive: false,
      }),
      description: `${slotSummary} | request mode: ${requestMode}`,
      searchText: `${profile.id} ${profile.label} ${profile.baseUrl} ${slotSummary} ${requestMode}`,
    }
  })

  const selectedId = await promptSelect(
    promptMessage,
    [
      ...options,
      {
        value: "__back__",
        label: "Back",
        description: "Return to previous menu",
        searchText: "back return",
      },
    ],
    options[0]?.value,
    { spacing: "major" },
  )
  if (selectedId === "__back__") {
    throw new PromptBackError()
  }
  const selectedProfile = profiles.find((profile) => profile.id === selectedId)
  if (!selectedProfile) {
    return undefined
  }

  return selectedProfile
}

function buildSelectionFromProfile(
  profile: ProviderProfile,
  modelSlots: ModelSlots,
): StartupSelection {
  return {
    providerOptions: {
      provider: profile.isPreset ? profile.id : "custom",
      providerBaseUrl: profile.baseUrl,
      providerApiKey: profile.apiKey,
      providerModel: modelSlots.defaultModel,
      providerSmallModel: modelSlots.haikuModel,
      providerRequestHandlingMode: profile.requestHandlingMode,
    },
    modelSlots,
  }
}

function describeClaudeSettingsSyncTarget(
  target: ClaudeSettingsSyncTarget,
): string {
  if (target === "global") {
    return "global (~/.claude/settings.json)"
  }

  return "local (.claude/settings.local.json)"
}

async function promptClaudeSettingsSyncTarget(
  initialTarget: ClaudeSettingsSyncTarget,
): Promise<ClaudeSettingsSyncTarget> {
  const selected = await promptSelect(
    "Sync Claude settings updates to",
    [
      {
        value: "local",
        label: "Local workspace settings",
        description:
          "Update nearest .claude/settings.local.json in this workspace",
        searchText: "local workspace settings.local.json",
      },
      {
        value: "global",
        label: "Global user settings",
        description: "Update ~/.claude/settings.json for all Claude sessions",
        searchText: "global user settings.json",
      },
    ],
    initialTarget,
    { spacing: "major" },
  )

  return selected === "global" ? "global" : "local"
}

function formatRequestHandlingModeLabel(mode?: string): string {
  return normalizeProviderRequestHandlingMode(mode)
}

async function promptRequestHandlingMode(
  initialMode?: string,
): Promise<ProviderRequestHandlingMode> {
  const normalizedInitial = normalizeProviderRequestHandlingMode(initialMode)
  const selected = await promptSelect(
    "Choose provider request handling mode",
    [
      {
        value: "strict",
        label: "strict",
        description:
          "Exactly one upstream call (no auto retry or compatibility fallback)",
        searchText: "single request one call no retry no fallback",
      },
      {
        value: "balanced",
        label: "balanced",
        description:
          "Bounded retries and compatibility fallback with call budget",
        searchText: "default retry fallback budget",
      },
      {
        value: "resilient",
        label: "resilient",
        description: "Larger bounded retry budget with compatibility fallback",
        searchText: "more retries robust",
      },
    ],
    normalizedInitial,
    { spacing: "minor" },
  )

  return normalizeProviderRequestHandlingMode(selected)
}

async function promptProviderApiKey(choice: ProviderChoice): Promise<string> {
  const existingApiKey = choice.existingProfile?.apiKey

  if (existingApiKey) {
    const keepExisting = await promptConfirm(
      `Use saved API key for ${choice.label}?`,
      true,
    )

    if (keepExisting) {
      return existingApiKey
    }
  }

  if (choice.apiKeyUrl) {
    consola.info(`Get API key for ${choice.label}: ${choice.apiKeyUrl}`)
  } else {
    consola.info(
      `Enter API key for ${choice.label}. Use your provider dashboard to generate it.`,
    )
  }

  return await promptText("Enter provider API key")
}

async function fetchProviderModels(
  providerId: string,
  baseUrl: string,
  apiKey: string,
): Promise<Array<string>> {
  if (isGeminiAiStudioProvider(providerId, baseUrl)) {
    const aiStudioModels = await fetchGeminiAiStudioModels(baseUrl, apiKey)
    if (aiStudioModels.length > 0) {
      return aiStudioModels
    }
  }

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>
    }

    if (!Array.isArray(payload.data)) {
      return []
    }

    return [
      ...new Set(
        payload.data
          .map((model) => model.id)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    ]
  } catch {
    return []
  }
}

function isGeminiAiStudioProvider(
  providerId: string,
  baseUrl: string,
): boolean {
  if (providerId.trim().toLowerCase() === "gemini") {
    return true
  }

  return baseUrl.toLowerCase().includes("generativelanguage.googleapis.com")
}

function resolveGeminiNativeModelsUrl(baseUrl: string, apiKey: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "")

  if (trimmedBase.endsWith("/openai")) {
    return `${trimmedBase.slice(0, -"/openai".length)}/models?key=${encodeURIComponent(apiKey)}`
  }

  return `${trimmedBase}/models?key=${encodeURIComponent(apiKey)}`
}

async function fetchGeminiAiStudioModels(
  baseUrl: string,
  apiKey: string,
): Promise<Array<string>> {
  if (!apiKey.trim()) {
    return []
  }

  try {
    const response = await fetch(
      resolveGeminiNativeModelsUrl(baseUrl, apiKey),
      {
        headers: {
          accept: "application/json",
        },
      },
    )

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as {
      models?: Array<{
        name?: string
        supportedGenerationMethods?: Array<string>
      }>
    }

    if (!Array.isArray(payload.models)) {
      return []
    }

    return [
      ...new Set(
        payload.models
          .filter((model) => {
            if (typeof model.name !== "string") {
              return false
            }

            const methods = model.supportedGenerationMethods
            if (!Array.isArray(methods)) {
              return true
            }

            return methods.some(
              (method) =>
                method === "generateContent"
                || method === "streamGenerateContent",
            )
          })
          .map((model) => model.name as string)
          .filter((name) => name.startsWith("models/"))
          .map((name) => name.slice("models/".length))
          .filter((name) => name.toLowerCase().includes("gemini"))
          .filter((name) => !name.toLowerCase().includes("embedding"))
          .filter((name) => !name.toLowerCase().includes("aqa"))
          .sort((a, b) => a.localeCompare(b)),
      ),
    ]
  } catch {
    return []
  }
}

async function promptModelFromSearch(
  slotLabel: string,
  models: Array<string>,
  initialModel?: string,
): Promise<string> {
  const featured = getFeaturedModelCandidates(models, 18)
  const manualOption = `Enter model id manually for ${slotLabel}`
  const orderedModels = [
    ...new Set([
      ...(initialModel ? [initialModel] : []),
      ...featured,
      ...models,
    ]),
  ]

  while (true) {
    const shortlist = [...new Set([...orderedModels, manualOption])]

    const selected = await promptSelect(
      `Search ${slotLabel}`,
      shortlist,
      initialModel && shortlist.includes(initialModel) ?
        initialModel
      : shortlist[0],
      { spacing: "minor" },
    )

    if (selected === manualOption) {
      return await promptText(`Enter ${slotLabel}`, initialModel)
    }

    return selected
  }
}

function deriveModelSlotsFromProviderPreferences(): ModelSlots | undefined {
  if (!state.provider.preferredModel) {
    return undefined
  }

  return normalizeModelSlots({
    defaultModel: state.provider.preferredModel,
    bigModel: state.provider.preferredModel,
    sonnetModel: state.provider.preferredModel,
    haikuModel:
      state.provider.preferredSmallModel || state.provider.preferredModel,
  })
}

function hasExplicitProviderConfiguration(options: RunServerOptions): boolean {
  return Boolean(
    options.provider
    || options.providerBaseUrl
    || options.providerApiKey
    || options.providerModel
    || options.providerSmallModel
    || process.env.PROVIDER
    || process.env.PROVIDER_BASE_URL
    || process.env.PROVIDER_API_KEY
    || process.env.PROVIDER_MODEL
    || process.env.PROVIDER_SMALL_MODEL,
  )
}

function stripBaseUrl(value: string): string {
  return value.replace(/\/+$/, "")
}

function buildCustomProviderId(label: string, baseUrl: string): string {
  const namePart = label
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")

  try {
    const parsed = new URL(baseUrl)
    const host = parsed.hostname.replaceAll(/[^a-z0-9]/gi, "-")

    const combined = [namePart, host]
      .filter((value) => value.length > 0)
      .join("-")

    return `custom-${combined || "provider"}`.toLowerCase()
  } catch {
    return `custom-${namePart || "provider"}`
  }
}

function buildDefaultModelSlotsForProvider(providerId: string): ModelSlots {
  const baseModel =
    providerId === "openrouter" ? "qwen/qwen3.6-plus:free" : FALLBACK_MODEL

  return normalizeModelSlots({
    defaultModel: baseModel,
    bigModel: baseModel,
    sonnetModel: baseModel,
    haikuModel: baseModel,
  })
}

async function promptSelect(
  message: string,
  options: Array<string | SearchableOption>,
  initial?: string,
  uiOptions: { spacing?: PromptSpacing } = {},
): Promise<string> {
  applyPromptSpacing(uiOptions.spacing || "minor")

  const normalizedOptions = options.map((option) => {
    if (typeof option === "string") {
      return {
        value: option,
        label: option,
        short: option,
        description: undefined,
        normalized: option.toLowerCase(),
      }
    }

    return {
      value: option.value,
      label: option.label,
      short: option.label,
      description: option.description,
      normalized:
        `${option.label} ${option.value} ${option.searchText || ""}`.toLowerCase(),
    }
  })

  let matchCount = normalizedOptions.length

  let selected: string
  try {
    selected = await promptSearchSelect<string>({
      message: `${message}\nSearch:`,
      default:
        (
          initial
          && normalizedOptions.some((option) => option.value === initial)
        ) ?
          initial
        : normalizedOptions[0]?.value,
      source: async (term) => {
        const q = String(term || "")
          .trim()
          .toLowerCase()
        const filtered =
          q.length === 0 ?
            normalizedOptions
          : normalizedOptions.filter((option) => option.normalized.includes(q))

        matchCount = filtered.length

        const visibleOptions =
          filtered.length > 0 ?
            filtered
          : [
              {
                value: "__no_results__",
                label: "No matches found",
                short: "No matches found",
                description: "Type a different search query",
                normalized: "",
              },
            ]

        return visibleOptions.map((option) => ({
          value: option.value,
          name: `  ${option.label}`,
          short: option.short,
          description:
            option.description ? `  ${option.description}` : undefined,
          disabled:
            option.value === "__no_results__" ? "Type to search" : undefined,
        }))
      },
      theme: {
        style: {
          searchTerm: (text: string) => {
            const status = buildSearchStatusLabel(text, matchCount)
            if (!status) {
              return ""
            }

            // Keep cursor at the end of typed query while still showing match count.
            const trailing =
              status.length > text.length ? status.slice(text.length) : ""
            if (!trailing) {
              return status
            }

            return `${status}\u001b[${trailing.length}D`
          },
          keysHelpTip: () =>
            "Up/Down to select | Enter: confirm | Type: to search",
        },
      },
      pageSize: 14,
    })
  } catch (error) {
    if (isPromptCancellationError(error)) {
      const now = Date.now()
      if (now - lastPromptCancelAt <= DOUBLE_ESCAPE_WINDOW_MS) {
        lastPromptCancelAt = 0
        throw new PromptExitError()
      }
      lastPromptCancelAt = now
      throw new PromptBackError()
    }

    throw error
  }

  return String(selected)
}

function isPromptCancellationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return /cancel|abort|force closed|exit prompt/i.test(
    `${error.name} ${error.message}`,
  )
}

async function promptConfirm(
  message: string,
  initial: boolean,
): Promise<boolean> {
  const selected = await consola.prompt(message, {
    type: "confirm",
    initial,
  })

  return Boolean(selected)
}

async function promptText(
  message: string,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const withDefault = defaultValue ? `${message} [${defaultValue}]` : message
    const value = await consola.prompt(withDefault, {
      type: "text",
    })

    const normalized = String(value || "").trim()
    if (normalized.length > 0) {
      return normalized
    }

    if (defaultValue) {
      return defaultValue
    }

    consola.warn("Input cannot be empty.")
  }
}

function applyPromptSpacing(spacing: PromptSpacing): void {
  if (spacing !== "major") {
    return
  }

  process.stdout.write("\n")
}

function summarizeModelSlotsForList(slots: ModelSlots): string {
  return `d=${shortModel(slots.defaultModel)} | o=${shortModel(slots.bigModel)} | s=${shortModel(slots.sonnetModel)} | h=${shortModel(slots.haikuModel)}`
}

function shortModel(model: string, max: number = 24): string {
  const summary = summarizeRoutedModel(model)
  if (summary.length <= max) {
    return summary
  }

  return `${summary.slice(0, Math.max(6, max - 3))}...`
}

function hasCopilotRoutedSlot(slots?: ModelSlots): boolean {
  if (!slots) {
    return false
  }

  return [
    slots.defaultModel,
    slots.bigModel,
    slots.sonnetModel,
    slots.haikuModel,
  ].some((model) => decodeRoutedModel(model)?.providerId === "copilot")
}

function getSlotModel(
  slots: ModelSlots,
  slot: "default" | "opus" | "sonnet" | "haiku",
): string {
  switch (slot) {
    case "default": {
      return slots.defaultModel
    }
    case "opus": {
      return slots.bigModel
    }
    case "sonnet": {
      return slots.sonnetModel
    }
    case "haiku": {
      return slots.haikuModel
    }
  }
}

function setSlotModel(
  slots: ModelSlots,
  slot: "default" | "opus" | "sonnet" | "haiku",
  value: string,
): ModelSlots {
  if (slot === "default") {
    return { ...slots, defaultModel: value }
  }
  if (slot === "opus") {
    return { ...slots, bigModel: value }
  }
  if (slot === "sonnet") {
    return { ...slots, sonnetModel: value }
  }
  return { ...slots, haikuModel: value }
}

function parseSlotLabel(
  label: string,
): "default" | "opus" | "sonnet" | "haiku" {
  const normalized = label.trim().toLowerCase()

  if (normalized.startsWith("default")) {
    return "default"
  }
  if (normalized.startsWith("opus")) {
    return "opus"
  }
  if (normalized.startsWith("sonnet")) {
    return "sonnet"
  }
  return "haiku"
}

export const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Claude Switch server",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port to listen on",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type to use (individual, business, enterprise)",
    },
    manual: {
      type: "boolean",
      default: false,
      description: "Enable manual request approval",
    },
    "rate-limit": {
      alias: "r",
      type: "string",
      description: "Rate limit in seconds between requests",
    },
    wait: {
      alias: "w",
      type: "boolean",
      default: false,
      description:
        "Wait instead of error when rate limit is hit. Has no effect if rate limit is not set",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token directly (must be generated using the `auth` subcommand)",
    },
    "claude-code": {
      alias: "c",
      type: "boolean",
      default: false,
      description:
        "Generate a command to launch Claude Code with Claude Switch config",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub and Copilot tokens on fetch and refresh",
    },
    provider: {
      type: "string",
      description:
        "Upstream provider preset: copilot, opencode, openrouter, groq, xai, nvidia-nim, gemini, custom",
    },
    "provider-base-url": {
      type: "string",
      description: "Override provider base URL",
    },
    "provider-api-key": {
      type: "string",
      description: "Override provider API key",
    },
    "provider-model": {
      type: "string",
      description: "Preferred default model for provider mode",
    },
    "provider-small-model": {
      type: "string",
      description: "Preferred small model for provider mode",
    },
    "provider-request-handling-mode": {
      type: "string",
      description: "Provider request policy: strict, balanced, or resilient",
    },
  },
  run({ args }) {
    const rateLimitRaw = args["rate-limit"]
    const rateLimit =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      rateLimitRaw === undefined ? undefined : Number.parseInt(rateLimitRaw, 10)

    return runServer({
      port: Number.parseInt(args.port, 10),
      verbose: args.verbose,
      accountType: args["account-type"],
      manual: args.manual,
      rateLimit,
      rateLimitWait: args.wait,
      githubToken: args["github-token"],
      claudeCode: args["claude-code"],
      showToken: args["show-token"],
      provider: args.provider,
      providerBaseUrl: args["provider-base-url"],
      providerApiKey: args["provider-api-key"],
      providerModel: args["provider-model"],
      providerSmallModel: args["provider-small-model"],
      providerRequestHandlingMode: args["provider-request-handling-mode"],
    })
  },
})
