---
name: finish-task
description: Finish a task from Curio's docs/TASKS.md. Runs the checks, confirms every test the task lists passes, ticks the task, and adds an entry to docs/DEVLOG.md.
argument-hint: "[task ID, such as T07]"
disable-model-invocation: true
---

# Finish task

Close one task in `docs/TASKS.md`. A task is ticked only on evidence. If anything below fails, stop, report what failed, and leave the box unticked.

## 1. Identify the task

Use the task ID given (`$ARGUMENTS`). Otherwise use the task this session has been working on, and if that isn't clear, ask. Read the task's whole block, noting its Tests and its Done when.

## 2. Run the checks

Run what CI runs, using the commands table in `CLAUDE.md`. If a command there arrives in a later task, say so; don't pretend a check ran.

- Lint, type-check and format check.
- Unit and web tests (Vitest), and Edge Function tests (Deno).
- pgTAP (`pnpm supabase test db`) on a freshly reset local database (`pnpm supabase db reset`).
- The fitness functions: RLS coverage, function privileges, error codes (DB-SCH-08), contract sync (regenerate the TypeScript and Swift types and confirm nothing changed) and import boundaries.
- The end-to-end journeys, if the task lists any E2E IDs.
- Anything else the task's tests need, such as k6 or Lighthouse.

Show the result of each. Don't skip a check because it's slow.

## 3. Confirm the listed tests

Each test is named by its test specification ID, so look for every ID the task lists in the output:

- every listed ID must appear in a run, and pass;
- a listed ID that didn't run counts as failed;
- for a non-functional test (NF-…) that a person runs, ask the user for the result and where it's recorded.

Then check the rest of the definition of done in `CLAUDE.md`: every refusal path in the change has a test, the generated types are current, the accessibility checks pass, and each point of the task's own Done when is met. For a task with "Tests: none", go through its Done when point by point and show the evidence for each.

The plan says a task is ticked only when its tests pass in CI. Once CI exists (T02), check the latest run for this change with `gh run list` and `gh run view`. If the change isn't pushed, or CI can't be checked, say so and ask the user to confirm before ticking.

## 4. Reviews

If the change touches `supabase/`, `packages/contracts`, or anything the data dictionary or spec §11 describes, run the `spec-reviewer` agent on it. If it touches sign-in, sessions, access rules, database or Edge Functions, secrets, headers, uploads, redirects or personal data, run the `security-reviewer` agent as well. Fix blocking findings first, or list them for the user. Don't tick while a blocking finding is open.

## 5. Tick and log

- In `docs/TASKS.md`, change the task's `- [ ]` to `- [x]`, and change nothing else in the file.
- In `docs/traceability.md` (it exists from T05), tick the task's requirement IDs and add the test evidence.
- Add an entry at the end of `docs/DEVLOG.md`, in the format at the top of that file.
- Don't commit unless the user asks.

Finish with a short report: whether the task was ticked, and if not why not; the evidence; and the next task in the plan.
