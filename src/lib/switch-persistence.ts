import type { StartupConfig } from "~/lib/startup-config"

export async function persistSwitchConfig(input: {
  config: StartupConfig
  sync: (config: StartupConfig) => Promise<void>
  save: (config: StartupConfig) => Promise<void>
}): Promise<void> {
  await input.sync(input.config)
  await input.save(input.config)
}
