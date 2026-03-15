Show the status of specs. Optional argument: a specific spec slug for detailed view.

Argument: $ARGUMENTS

---

## Step 1: Find All Specs

Use Glob to find all `docs/specs/*/status.json` files. Also find all `docs/specs/*/spec.md` files.

If no specs exist, tell the user: "No specs found in `docs/specs/`. Create one with `/spec <feature idea>`."

---

## Step 2: Read and Parse

For each spec directory found:

1. Read `status.json` to get task-level status
2. Read the YAML frontmatter from `spec.md` to get title, status, domains, dates

Calculate completion percentage: `(completed tasks / total tasks) * 100`

---

## Step 3: Display

### If no argument provided (summary view):

Display a table of all specs:

```
Spec                  | Status      | Progress | Domains              | Updated
----------------------|-------------|----------|----------------------|-----------
feature-name          | in-progress | 60%      | database, api, fe    | 2025-01-15
another-feature       | completed   | 100%     | api, frontend        | 2025-01-14
draft-feature         | draft       | 0%       | database, api        | 2025-01-13
```

Status indicators:
- `draft` -- not yet approved
- `approved` -- ready for `/implement`
- `in-progress` -- implementation underway
- `completed` -- all tasks done and verified
- `partial` -- some tasks blocked/failed

### If argument provided (detailed view):

Read the specific spec's status.json and spec.md. Display:

1. **Header**: Title, status, branch, last updated
2. **Task breakdown table**:

```
Task | Domain   | Title                    | Status    | Attempts | Error
-----|----------|--------------------------|-----------|----------|------
T1   | database | Create users table       | completed | 1        | -
T2   | api      | Add user endpoints       | completed | 1        | -
T3   | api      | Add user service         | failed    | 2        | Build error in UserService.cs
T4   | frontend | User management page     | blocked   | 0        | dependency T3 failed
```

3. **Summary**: X of Y tasks completed, Z blocked/failed
4. **Next steps**: Suggest actions based on state:
   - If `draft`: "Set status to `approved` in spec.md, then run `/implement {slug}`"
   - If `approved`: "Run `/implement {slug}` to begin implementation"
   - If blocked tasks exist: "Fix the failed tasks manually, update status.json, then re-run `/implement {slug}`"
   - If `completed`: "Create a PR with `/commit` and push for review"
