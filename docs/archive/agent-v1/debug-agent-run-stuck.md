# Debug Session: agent-run-stuck

Status: [OPEN]

## Symptom

- Agent run nodes stay in `Thinking...`.
- Run Trace shows no events.
- Expected: `/api/agent-run` streams runtime events and the run progresses to tool execution or an explicit error.

## Hypotheses

1. Frontend submit path creates a run node but does not send a request to `/api/agent-run`.
2. Server rejects the request during auth/input normalization before runtime events are emitted.
3. Runtime throws during routing/planning/skill access before the first visible event reaches the client.
4. UI receives stream chunks but filters or fails to project them into Run Trace.
5. Required model/tool environment is missing, causing execution to fail before event rendering.

## Evidence Log

- Debug server running at `.dbg/agent-run-stuck.env`.
- `pnpm lint` passes after instrumentation.
- Pre-fix logs confirm `/api/agent-run` receives and validates the request.
- Pre-fix logs confirm `executeAgentRun` enters, loads `prompt-expand`, and builds 10 runtime tools.
- Pre-fix logs confirm `normalizeAgentInput` succeeds.
- Pre-fix logs confirm `upsertAgentRunSnapshot` fails with `PGRST205`: `Could not find the table 'public.agent_runs' in the schema cache`.
- Because `store.createRun()` persists before the runtime `try/catch`, no `run.failed` event is emitted to the canvas.

## Changes

- Added temporary debug reporting around `/api/agent-run` request validation.
- Added temporary debug reporting around `executeAgentRun` pre-run skill/tool-registry setup.
- Added temporary debug reporting around `agent_runs` upsert.
# Archived Agent v1 Debug Notes

> 归档于 2026-06-11。本文描述的 v1 runtime 已删除，不再用于当前问题排查。当前 Agent 事实以 `server/agent/`、`README.md` 和根目录 `AGENTS.md` 为准。
