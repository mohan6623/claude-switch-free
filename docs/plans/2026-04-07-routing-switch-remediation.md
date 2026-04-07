# Routing and Switch Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate confirmed routed-model and switch-flow defects, then lock behavior with regression tests.

**Architecture:** Apply targeted helper extraction for hard-to-test logic while keeping the existing CLI and handler orchestration stable. Each defect is fixed via TDD with failing tests first, then minimal implementation, then verification.

**Tech Stack:** TypeScript, Bun test runner (bun:test), Hono handlers, Citty CLI commands, existing copilot-api runtime state.

---

### Task 0: Environment gate for Bun-based TDD

**Files:**
- Modify: none

**Step 1: Validate Bun availability in the active shell**

Run: `bun --version`
Expected: Bun version output.

**Step 2: If unavailable, locate or install Bun**

Run: `where.exe bun`
Expected: path to bun executable.

If still unavailable, run installer:
- PowerShell: `irm bun.sh/install.ps1 | iex`

Then reopen shell or set PATH for session and re-run:
- `bun --version`

**Step 3: Run baseline tests and capture failures**

Run: `bun test`
Expected: some tests fail or pass; output captured as baseline.

**Step 4: Commit (only if environment bootstrap scripts/config were changed)**

```bash
git add -A
git commit -m "chore: stabilize bun execution environment"
```

### Task 1: Fix GPT routed multimodal translation dropping images

**Files:**
- Modify: `src/routes/messages/non-stream-translation.ts`
- Modify: `tests/anthropic-request.test.ts`

**Step 1: Write the failing test**

Add test in `tests/anthropic-request.test.ts`:
- Use routed GPT model id: `cpapi-route:openrouter::gpt-4o`
- Include user message content with text + image block.
- Assert translated payload keeps image as `image_url` content part.
- Assert `providerIdOverride === "openrouter"`.

**Step 2: Run test to verify it fails**

Run: `bun test tests/anthropic-request.test.ts`
Expected: FAIL showing image content was dropped/flattened.

**Step 3: Write minimal implementation**

Update `mapContent` in `src/routes/messages/non-stream-translation.ts`:
- For GPT path, remove only `thinking` blocks.
- Preserve `text` and `image` blocks.
- Keep existing string join behavior for text-only content.

**Step 4: Run test to verify it passes**

Run: `bun test tests/anthropic-request.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/anthropic-request.test.ts src/routes/messages/non-stream-translation.ts
git commit -m "fix: preserve image blocks for routed gpt translation"
```

### Task 2: Prevent active-provider drift during model-mapping edits

**Files:**
- Create: `src/lib/switch-model-draft.ts`
- Create: `tests/switch-model-draft.test.ts`
- Modify: `src/start.ts`

**Step 1: Write the failing test**

Create `tests/switch-model-draft.test.ts` with cases:
- Given active profile `openrouter`, editing slots with last selected provider `copilot` must not change `activeProviderId`.
- Updated slot mappings are persisted to the active profile.

**Step 2: Run test to verify it fails**

Run: `bun test tests/switch-model-draft.test.ts`
Expected: FAIL because helper does not exist.

**Step 3: Write minimal implementation**

Create `src/lib/switch-model-draft.ts` with a pure helper that:
- Accepts startup config, active profile, and new model slots.
- Upserts updated active profile modelSlots.
- Keeps `activeProviderId` as current active profile id.

Wire `runChangeModelDraft` in `src/start.ts` to this helper.

**Step 4: Run test to verify it passes**

Run: `bun test tests/switch-model-draft.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/switch-model-draft.ts tests/switch-model-draft.test.ts src/start.ts
git commit -m "fix: keep active provider stable when editing model mappings"
```

### Task 3: Fix token-count heuristics for routed models

**Files:**
- Create: `src/routes/messages/token-heuristics.ts`
- Create: `tests/token-heuristics.test.ts`
- Modify: `src/routes/messages/count-tokens-handler.ts`

**Step 1: Write the failing test**

Create `tests/token-heuristics.test.ts` covering:
- Routed Claude model receives Claude surcharge/multiplier.
- Routed Grok model receives Grok surcharge/multiplier.
- Non-matching models receive no provider surcharge.

**Step 2: Run test to verify it fails**

Run: `bun test tests/token-heuristics.test.ts`
Expected: FAIL because helper does not exist.

**Step 3: Write minimal implementation**

Create `src/routes/messages/token-heuristics.ts` with pure functions:
- Determine effective provider family from translated model id.
- Apply tool surcharge and final multiplier consistently.

Update `count-tokens-handler.ts` to use translated/effective model-based heuristics instead of raw `anthropicPayload.model.startsWith(...)`.

**Step 4: Run test to verify it passes**

Run: `bun test tests/token-heuristics.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/routes/messages/token-heuristics.ts tests/token-heuristics.test.ts src/routes/messages/count-tokens-handler.ts
git commit -m "fix: apply token heuristics using effective routed model family"
```

### Task 4: Make switch save/sync behavior consistent across save paths

**Files:**
- Create: `src/lib/switch-persistence.ts`
- Create: `tests/switch-persistence.test.ts`
- Modify: `src/start.ts`

**Step 1: Write the failing test**

Create `tests/switch-persistence.test.ts` with cases:
- Save operation invokes both Claude settings sync and config save.
- No-op save path does not write when there are no changes.

**Step 2: Run test to verify it fails**

Run: `bun test tests/switch-persistence.test.ts`
Expected: FAIL because helper does not exist.

**Step 3: Write minimal implementation**

Create `src/lib/switch-persistence.ts` helper(s) to centralize:
- `syncClaudeSettingsFromStartupConfig(...)`
- `saveStartupConfig(...)`

Update `src/start.ts` to route Continue/Add/Update/Switch and explicit save/exit through shared persistence semantics.

**Step 4: Run test to verify it passes**

Run: `bun test tests/switch-persistence.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/switch-persistence.ts tests/switch-persistence.test.ts src/start.ts
git commit -m "refactor: unify switch-mode save and claude sync semantics"
```

### Task 5: Add handler-level regression test for routed provider override

**Files:**
- Create: `tests/messages-handler-routing.test.ts`
- Modify: `src/routes/messages/handler.ts` (only if needed for testability seams)

**Step 1: Write the failing test**

Create `tests/messages-handler-routing.test.ts` that:
- Sends routed model request payload.
- Asserts provider override resolution is requested with routed provider id.
- Asserts `createChatCompletions` receives override config.

**Step 2: Run test to verify it fails**

Run: `bun test tests/messages-handler-routing.test.ts`
Expected: FAIL due missing test harness/mocks until implementation seams are in place.

**Step 3: Write minimal implementation**

Add minimal seams/mocking hooks only if required by Bun mocking behavior. Avoid runtime behavior changes.

**Step 4: Run test to verify it passes**

Run: `bun test tests/messages-handler-routing.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/messages-handler-routing.test.ts src/routes/messages/handler.ts
git commit -m "test: cover routed provider override in messages handler"
```

### Task 6: Verification gate before completion

**Files:**
- Modify as needed from previous tasks

**Step 1: Run targeted suite for changed areas**

Run:
- `bun test tests/anthropic-request.test.ts`
- `bun test tests/switch-model-draft.test.ts`
- `bun test tests/token-heuristics.test.ts`
- `bun test tests/switch-persistence.test.ts`
- `bun test tests/messages-handler-routing.test.ts`

Expected: all PASS.

**Step 2: Run full suite and static checks**

Run:
- `bun test`
- `npm run typecheck`
- `npm run build`
- `npm run lint`

Expected: pass, or clearly separated pre-existing lint baseline documented if full lint still contains unrelated historical issues.

**Step 3: Commit final verification updates if needed**

```bash
git add -A
git commit -m "test: finalize regressions for routed models and switch flow"
```
