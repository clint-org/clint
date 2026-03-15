Implement the approved spec: $ARGUMENTS

This is the orchestrator. Follow these phases exactly. After the user confirms the execution plan, run fully unsupervised until completion or failure.

---

## Phase 1: Validate

1. Resolve the spec path. If `$ARGUMENTS` is a slug, look for `docs/specs/$ARGUMENTS/spec.md`. If it is a path, use it directly.

2. Read the spec.md file. Parse the YAML frontmatter. **Abort if status is not `approved`** -- tell the user to set status to `approved` first.

3. Extract the tasks YAML block from the fenced code block labeled `yaml` inside the `## Tasks` section. Parse it into a structured list.

4. Read `docs/specs/{slug}/status.json`. If any tasks are already `completed`, skip them in execution. If any are `in-progress` or `blocked`, note them for the plan.

5. Read the domain CLAUDE.md files for every domain referenced in the tasks:
   - `database` -> `src/db/CLAUDE.md`
   - `api` -> `src/server/CLAUDE.md`
   - `frontend` -> `src/client/CLAUDE.md`

---

## Phase 2: Plan Execution Waves

Build a DAG from task `depends_on` fields. Group tasks into waves:

- **Wave 1**: Tasks with no dependencies (typically database migrations)
- **Wave 2**: Tasks depending only on Wave 1 tasks
- **Wave N**: Tasks depending on earlier waves

Within each wave, tasks targeting **disjoint file sets** can run in parallel.

Rules:
- Database migration tasks always run **sequentially** even within the same wave (ordered by task ID)
- Tasks in the same domain with overlapping files must be sequential
- Maximum parallel agents per wave: 4

---

## Phase 3: Present Plan and Confirm

Display the execution plan as a table:

```
Wave | Task | Domain   | Title                    | Parallel | Dependencies
-----|------|----------|--------------------------|----------|-------------
1    | T1   | database | Create users table       | no       | none
2    | T2   | api      | Add user endpoints       | yes      | T1
2    | T3   | api      | Add user service         | yes      | T1
3    | T4   | frontend | User management page     | no       | T2, T3
```

Then ask the user for a **single confirmation** using AskUserQuestion:
- "Execute this plan? After confirmation, implementation runs fully unsupervised."
- Options: "Execute" / "Cancel"

**If cancelled, stop entirely.**

---

## Phase 4: Create Branch

1. Check that the working tree is clean (`git status --porcelain`). If dirty, **abort** and tell the user to commit or stash changes first.

2. Create and switch to branch `spec/{slug}` from the current branch:
   ```
   git checkout -b spec/{slug}
   ```

3. Update status.json: set `status` to `in-progress`, set `branch` to `spec/{slug}`.

4. Commit status.json: `start implementation of {slug}`.

---

## Phase 5: Execute Waves

Process each wave sequentially. Within each wave, launch parallel agents for independent tasks.

For **each task**, build the agent prompt:

```
Implement the following task from spec docs/specs/{slug}/spec.md:

**Task {id}**: {title}
**Domain**: {domain}
**Files to create/modify**: {files list}

Read the following before starting:
- The full spec at docs/specs/{slug}/spec.md (focus on the {domain} design section)
- The domain guide at {domain CLAUDE.md path}
- The relevant developer guides for the target location's conventions (read these and follow them exactly):
  - Frontend data-access: docs/developer-guides/ui/data-access.md
  - Frontend components: docs/developer-guides/ui/components.md
  - Frontend folder structure: docs/developer-guides/ui/folder-structure.md

Implementation requirements:
- Only create or modify the files listed above
- Follow all conventions from the domain CLAUDE.md and the developer guides above
- When moving or creating files, verify that all naming (types, files, folders) matches the conventions in the developer guides. Do not copy files verbatim from old locations.
- Do not add comments except for complex/non-obvious logic
- Run the verification command when done: {verification}
- If verification fails, fix the issues and re-run

Acceptance criteria: {acceptance}
```

**Dispatching rules:**
- For waves with fewer than 5 parallel tasks: use `Agent` tool with `subagent_type: "general-purpose"` (agents work on disjoint files in the same branch)
- For waves with 5+ parallel tasks: use `Agent` tool with `isolation: "worktree"` for true git isolation
- Launch all parallel tasks in a single message (multiple Agent tool calls)
- Database migration tasks: always launch sequentially, one at a time

**After each agent completes:**
1. Check if the agent succeeded or failed from its response
2. Update status.json for that task: set status to `completed` or `failed` with error details
3. If failed: retry once with a new agent that includes the error context. If retry fails, mark as `blocked`.

**After each wave completes:**
1. Stage and commit all changes: `implement {slug}: {wave summary}`
2. Check for any blocked tasks. If a blocked task has downstream dependents, mark those as `blocked` too.
3. Update status.json and commit it.
4. Proceed to next wave (skipping any blocked tasks).

---

## Phase 6: Integration Verification

After all waves complete (or all remaining tasks are blocked):

1. Determine which domains were touched by completed tasks.

2. Run verification commands for each touched domain:
   - **database**: `cd deploy/local && ./run migrate ost`
   - **api**: `cd src/server/OSTApp && dotnet build && dotnet test OSTApp.Api.Tests`
   - **frontend**: `cd src/client && npx nx build ost && npx nx lint ost && npx nx test ost --watch=false`

3. If any verification fails, launch a fix agent with the error output and the list of files from that domain's tasks. The fix agent should diagnose and fix the issue, then re-run verification.

4. Retry up to **3 cycles**. If verification still fails after 3 retries:
   - Preserve all work (do not revert)
   - Commit current state
   - Update status.json with the failure details
   - Report the failure to the user with error details

---

## Phase 7: Finalize

1. Update `docs/specs/{slug}/status.json`:
   - Set `status` to `completed` (or `partial` if some tasks are blocked)
   - Set all successful task statuses to `completed`
   - Set `updatedAt` to current ISO timestamp

2. Update the spec.md frontmatter:
   - Set `status` to `completed` (or `in-progress` if partial)
   - Set `updated` to today's date

3. Commit: `complete implementation of {slug}`

4. Report results to the user:
   - Summary of completed/blocked/failed tasks
   - Branch name for review
   - Any verification failures or issues encountered
   - Suggest next steps (PR creation, manual testing, etc.)

---

## Error Handling Rules

- **Agent failure**: Retry once with error context. If retry fails, mark task as `blocked` and continue with independent tasks.
- **Dependency failure**: Skip all downstream tasks, mark them as `blocked` with reason "dependency {id} failed".
- **Verification failure**: Up to 3 fix cycles. After that, stop and report.
- **Never** force-push, rewrite history, or use `--no-verify`.
- **Never** modify files outside the task's declared file list without explicit reason.
- **Always** preserve work -- never revert or discard changes on failure.
