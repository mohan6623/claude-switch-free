# Interactive Provider Startup Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a robust startup wizard that asks users to choose Copilot Pro or provider mode, persists provider/model slot selections, and reuses saved selections unless the user chooses to change them.

**Architecture:** Introduce a persistent startup configuration store under the app data directory and a small startup wizard service that handles provider choice, provider credential setup, model slot selection, and reuse/update decisions. Keep interactive prompt orchestration in startup utilities, while preserving existing request routing and provider config resolution.

**Tech Stack:** TypeScript, Bun test, citty/consola prompts, existing claude-switch runtime state.

---

### Task 1: Persist startup profiles for providers and model slots

**Files:**
- Modify: `src/lib/paths.ts`
- Create: `src/lib/startup-config.ts`
- Test: `tests/startup-config.test.ts`

**Step 1: Write the failing test**

```typescript
test("loads empty config when file missing and saves provider profile", async () => {
  // Arrange temp app dir + paths
  // Act load config, save profile with model slots, load again
  // Assert saved provider and model slots persisted
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/startup-config.test.ts`
Expected: FAIL because `startup-config.ts` and paths do not exist.

**Step 3: Write minimal implementation**

```typescript
export async function loadStartupConfig() { /* default object */ }
export async function saveStartupConfig(config) { /* write JSON */ }
export function upsertProviderProfile(config, profile) { /* replace/add by id */ }
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/startup-config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/paths.ts src/lib/startup-config.ts tests/startup-config.test.ts
git commit -m "feat: persist startup provider and model profiles"
```

### Task 2: Add startup wizard decision logic with reusable model slots

**Files:**
- Create: `src/lib/startup-wizard.ts`
- Test: `tests/startup-wizard.test.ts`

**Step 1: Write the failing test**

```typescript
test("builds provider runtime settings from saved profile and keeps previous models when user keeps config", () => {
  // Arrange saved provider profile + keepExisting=true
  // Act derive startup selection
  // Assert provider runtime and model slots unchanged
})

test("requires model reselection when user chooses change", () => {
  // Arrange saved profile + changeModels=true
  // Act derive startup flow state
  // Assert wizard requests 4 slot prompts
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/startup-wizard.test.ts`
Expected: FAIL because wizard module and helpers do not exist.

**Step 3: Write minimal implementation**

```typescript
export interface ProviderPreset { id: string; baseUrl: string; apiKeyUrl: string }
export function getProviderPresets(): ProviderPreset[]
export function shouldReuseSavedModels(...): boolean
export function normalizeModelSlots(...): ModelSlots
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/startup-wizard.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/startup-wizard.ts tests/startup-wizard.test.ts
git commit -m "feat: add startup wizard selection and model slot logic"
```

### Task 3: Integrate startup wizard into start command flow

**Files:**
- Modify: `src/start.ts`
- Test: `tests/start-flow.test.ts` (or add focused tests in existing startup tests)

**Step 1: Write the failing test**

```typescript
test("uses copilot mode when user chooses Copilot Pro", async () => {
  // Arrange prompt stubs returning copilot choice
  // Act run startup selection
  // Assert provider mode is copilot and no provider model prompts called
})

test("uses provider mode and persists selected default/opus/sonnet/haiku models", async () => {
  // Arrange prompt stubs returning provider + selected models
  // Act run startup selection
  // Assert provider state + persisted slots + mapped claude env fields
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/start-flow.test.ts`
Expected: FAIL because prompt-integrated startup flow is not implemented.

**Step 3: Write minimal implementation**

```typescript
// In runServer startup:
// 1) Ask mode: Copilot Pro vs Provider
// 2) If provider: choose preset/custom, collect API key/base URL as needed
// 3) Ask keep existing models vs change
// 4) If change/new: searchable selection per slot (default, opus, sonnet, haiku)
// 5) Persist profile and apply provider config to state
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/start-flow.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/start.ts tests/start-flow.test.ts
git commit -m "feat: add interactive startup mode and provider model slot flow"
```

### Task 4: Wire Claude env generation to all four slots and document provider API key links

**Files:**
- Modify: `src/start.ts`
- Modify: `README.md`
- Test: `tests/start-flow.test.ts` (add env mapping assertion)

**Step 1: Write the failing test**

```typescript
test("maps selected slots to ANTHROPIC_MODEL/SONNET/OPUS/HAIKU/SMALL_FAST", () => {
  // Arrange selected slot models
  // Act generate claude env object
  // Assert all env keys mapped correctly
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/start-flow.test.ts`
Expected: FAIL due missing Opus mapping and slot helper.

**Step 3: Write minimal implementation**

```typescript
// Add helper to build Claude env from slot selections and include:
// ANTHROPIC_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL,
// ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL,
// ANTHROPIC_SMALL_FAST_MODEL
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/start-flow.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/start.ts README.md tests/start-flow.test.ts
git commit -m "docs: add startup wizard flow and API key guidance"
```

### Task 5: Verify full suite and regression safety

**Files:**
- Modify as needed from previous tasks

**Step 1: Run targeted tests**

Run: `bun test tests/startup-config.test.ts tests/startup-wizard.test.ts tests/start-flow.test.ts`
Expected: PASS.

**Step 2: Run full tests and typecheck**

Run: `bun test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

**Step 3: Commit verification updates if needed**

```bash
git add -A
git commit -m "test: finalize startup wizard coverage and regressions"
```
