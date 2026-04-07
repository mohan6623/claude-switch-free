export const ROUTED_MODEL_PREFIX = "cpapi-route:"

export interface RoutedModelSelection {
  providerId: string
  model: string
}

export function encodeRoutedModel(
  providerId: string,
  model: string,
): string {
  const safeProvider = providerId.trim().toLowerCase()
  const safeModel = model.trim()
  if (!safeProvider || !safeModel) {
    throw new Error("providerId and model are required to encode routed model")
  }

  return `${ROUTED_MODEL_PREFIX}${safeProvider}::${encodeURIComponent(safeModel)}`
}

export function decodeRoutedModel(model: string): RoutedModelSelection | undefined {
  const value = model.trim()
  if (!value.startsWith(ROUTED_MODEL_PREFIX)) {
    return undefined
  }

  const payload = value.slice(ROUTED_MODEL_PREFIX.length)
  const delimiterIndex = payload.indexOf("::")
  if (delimiterIndex <= 0) {
    return undefined
  }

  const providerId = payload.slice(0, delimiterIndex).trim().toLowerCase()
  const encodedModel = payload.slice(delimiterIndex + 2)
  if (!providerId || !encodedModel) {
    return undefined
  }

  try {
    const decodedModel = decodeURIComponent(encodedModel)
    if (!decodedModel.trim()) {
      return undefined
    }

    return {
      providerId,
      model: decodedModel,
    }
  } catch {
    return undefined
  }
}

export function resolveRequestedModel(model: string): {
  model: string
  providerId?: string
} {
  const routed = decodeRoutedModel(model)
  if (!routed) {
    return { model }
  }

  return {
    model: routed.model,
    providerId: routed.providerId,
  }
}

export function summarizeRoutedModel(model: string): string {
  const routed = decodeRoutedModel(model)
  if (!routed) {
    return model
  }

  return `${routed.model} @ ${routed.providerId}`
}
