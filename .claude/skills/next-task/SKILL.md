---
name: next-task
description: Find the next unticked task in docs/TASKS.md (or the task named), read the spec sections and test IDs it lists, and propose a plan for the user to approve. Use when starting the next piece of Curio's build plan, or when asked what to work on next.
argument-hint: "[task ID, such as T07]"
---

# Next task

Propose a plan for one task in `docs/TASKS.md`. This only plans: don't write code, create migrations or tick anything. The user approves the plan first.

## 1. Pick the task

- If a task ID was given (`$ARGUMENTS`), use that task.
- Otherwise take the first task in `docs/TASKS.md` whose box is unticked (`- [ ] **Tnn`), reading in file order. Skip the iOS track (T71–T78) unless T56 is ticked and `docs/DEVLOG.md` records the decision as go. Skip "Not scheduled" (T79–T81) unless asked.
- If that task is marked "(you)", say what it needs from the user, then offer the next task Claude can do.
- If it waits on an open question in `docs/TASKS.md`, or on an earlier task that isn't ticked yet, say which, then offer the next task that isn't blocked.

## 2. Read what it lists

- The task's whole block: Builds, Requirements, Tests, Read and Done when.
- Everything under "Read". `CLAUDE.md`'s docs map says which file holds each spec section. For a screen, check `docs/design/differences.md` first, then read its row in section 9 of the brief (`docs/design/wireframes/curio-wireframe-brief.md`) with the rules in sections 5 and 6, and find its frames through the README in `docs/design/wireframes/`.
- Each requirement ID, in spec §3–5.
- Each test ID, in `docs/Test_specification.md`: its case, its pass condition and the fixtures it uses.
- What already exists in the repo for this area, so the plan builds on it rather than beside it.

## 3. Propose the plan

Give the user, briefly:

1. **The task:** its ID, title and sprint, and why it's next.
2. **What it builds:** the files to add or change, migrations first.
3. **Tests first:** each listed test ID on one line, saying what it checks and where it'll live (pgTAP in `supabase/tests`, Vitest beside the code, Deno tests in `supabase/functions`, Playwright in `apps/web/e2e`). Tests are named by their ID.
4. **Steps,** in order, each small enough to check on its own.
5. **What it must match:** the contract details, the order of checks, the error codes and the data dictionary rules, with the section for each.
6. **Gaps and conflicts:** anything the spec doesn't cover, or where the spec, data dictionary and test specification disagree. These are questions for the user. Where only the wireframes or the brief differ from the spec, the spec wins: say what will be added to `docs/design/differences.md`.
7. **Before finishing:** which reviewers to run (`spec-reviewer` for database, contract or Edge Function changes; `security-reviewer` for anything in spec §13's threat model), and what `/finish-task` will need to see.

Then stop and wait for the user to approve or change the plan.
