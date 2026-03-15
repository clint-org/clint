Create a detailed spec from the feature idea: $ARGUMENTS

Follow these phases exactly. Do not skip phases or combine them.

---

## Phase 1: Explore

Understand the codebase areas this feature will touch.

1. Read the domain CLAUDE.md files relevant to this feature:
   - `src/client/CLAUDE.md` (if frontend work needed)
   - `src/server/CLAUDE.md` (if API work needed)
   - `src/db/CLAUDE.md` and `src/db/README.md` (if database work needed)

2. Launch Explore agents in parallel to investigate:
   - Existing patterns similar to this feature (search for analogous implementations)
   - Database schema relevant to this feature
   - API endpoints and services related to this feature
   - Frontend components and routing related to this feature
   - Permify schema if permissions are involved
   - Existing domain events related to this feature (BaseEvent subclasses, event topics, subscriber handlers)
   - Cache keys and caching patterns related to this feature (CacheKeys.*, FusionCache usage)
   - Observability patterns (ICallContext, correlation ID flow, structured logging)

3. **Data-access consumer trace** (required when the feature involves extracting or moving code into new libraries):
   - For every data-access file the feature will consume (repos, adapters, DTOs, interfaces, constants, pipes, guards, services, stores), grep for all imports across the codebase
   - Classify each file as **feature-local** (zero consumers outside this feature -- must move into the feature library) or **shared** (consumers in other features -- stays in shared data-access)
   - Record the trace results for the spec's Design section

3. Read any related system design docs in `docs/system-design/` that inform this feature. Also check:
   - `docs/developer-guides/FUSION-CACHE-GUIDE.md` for caching conventions
   - `docs/developer-guides/rabbitMQ-event-driven-architecture-guide-101.md` for event patterns
   - `docs/developer-guides/ost-logging-guide-101.md` for logging conventions

4. Read `docs/specs/_template/spec-template.md` to understand the output format.

Summarize findings before proceeding.

---

## Phase 2: Clarify

Ask the user targeted questions using AskUserQuestion. Cover:

- **Scope boundaries**: What is explicitly in/out of scope?
- **Edge cases**: How should the feature handle error states, empty states, concurrent access?
- **Permissions**: Who can access this? What Permify relations apply?
- **Database impact**: New tables vs. modifying existing? Data migration needed?
- **Events**: What domain events should this feature publish? Any events to subscribe to? (Follow BaseEvent conventions: `<domain>.<entity>.<action>`)
- **Caching**: What data should be cached? What invalidation triggers apply? Which duration tier (Short/Medium/Long)?
- **Observability**: Any critical flows that need correlation tracking beyond the default?
- **UI/UX**: Any specific layout, flow, or interaction requirements?
- **Constraints**: Performance requirements, backwards compatibility, rollout strategy?

Ask only questions where the answer is not obvious from the codebase exploration. Group related questions into a single AskUserQuestion call (max 4 questions per call). Continue asking until all ambiguity is resolved.

---

## Phase 3: Generate

Produce the spec following `docs/specs/_template/spec-template.md` exactly.

Rules for the tasks YAML block:
- Decompose into single-domain work units (one task should not span database + API)
- Every task lists exact file paths that will be created or modified
- Minimize dependencies; typical flow: database -> API -> frontend
- Each task has a concrete verification command from the project's verification commands
- Size tasks so one agent can complete each within context limits
- Database migration tasks must be sequential with ordered timestamps
- Use kebab-case for the spec slug derived from the feature title

**Data-access migration rules** (when extracting feature libraries):
- Read `docs/developer-guides/ui/data-access.md` and `docs/developer-guides/ui/folder-structure.md` for naming conventions and dependency rules
- If the consumer trace from Phase 1 identified feature-local data-access files, the spec MUST include tasks to move them into the feature library. Do not leave feature-specific repos, adapters, DTOs, or interfaces in shared data-access.
- Include a **Data Access Migration** subsection in the Frontend Design section listing:
  - Files moving into the feature library (with source and destination paths, renamed to match the conventions in the developer guides)
  - Files staying in shared (with justification: list the external consumers)
- Never leave data-access migration decisions as "open questions" -- resolve them during spec generation using the consumer trace

Generate a unique spec id using format `spec-YYYY-NNN` where YYYY is the current year and NNN is incremented from existing specs.

---

## Phase 4: Write and Review

1. Determine the spec slug (kebab-case from the feature title).

2. Create the directory: `docs/specs/{slug}/`

3. Write the spec to `docs/specs/{slug}/spec.md` with:
   - All YAML frontmatter fields populated
   - Status set to `draft`
   - All sections filled in from your analysis
   - Tasks YAML block with parseable task definitions

4. Create the initial `docs/specs/{slug}/status.json`:
```json
{
  "specId": "spec-YYYY-NNN",
  "status": "draft",
  "branch": null,
  "tasks": {
    "T1": { "status": "pending", "agent": null, "attempts": 0, "error": null },
    "T2": { "status": "pending", "agent": null, "attempts": 0, "error": null }
  },
  "updatedAt": "ISO-8601 timestamp"
}
```

5. Present the spec to the user. Tell them:
   - Review the spec at the file path
   - Edit anything that needs changing
   - When satisfied, change the frontmatter `status` from `draft` to `approved`
   - Then run `/implement {slug}` to execute it
