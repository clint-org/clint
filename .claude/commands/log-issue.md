Log a diagnosed bug as a GitHub issue with a consistent root-cause writeup, then link it to the fixing PR. Optional argument: $ARGUMENTS (a title hint or pointer; if omitted, use the bug just diagnosed in this conversation).

Use this right after diagnosing a defect, BEFORE writing the fix. The issue becomes the durable record; the fixing PR closes it with `Closes #N`.

Repo: `clint-org/clint`.

---

## Step 1: Assemble the writeup

From the current conversation (or `$ARGUMENTS`), assemble these sections. Do not invent details -- if a section is genuinely unknown, write `TBD`, never a guess.

- **Title** -- one specific line, no period. Name the symptom and the surface (e.g. "CT.gov anticipated trial markers show a stray `c` provenance badge").
- **Summary** -- 1-2 sentences: what's wrong and where the user sees it.
- **Root cause** -- the actual mechanism, with `path:line` references to the offending code/migration. If the bug is data, not code, say so.
- **Evidence** -- concrete proof in fenced code blocks: a failing query's output, prod/dev row counts, a repro, the exact mapping line. Cite which environment.
- **Expected vs actual** -- one line each.
- **Proposed fix** -- a checklist (`- [ ]`) of the steps, including the test that guards it.

## Step 2: Create the issue

Body template (fill in from Step 1):

```markdown
## Summary
<summary>

## Root cause
<root cause, with path:line refs>

## Evidence
<fenced output / counts / repro>

## Expected vs actual
- **Expected:** <...>
- **Actual:** <...>

## Proposed fix
- [ ] <step>
- [ ] <test>
```

Create it (always `bug`; add an area label too if one already exists -- run `gh label list` first and only use labels that exist, never invent one):

```bash
gh issue create --repo clint-org/clint --title "<title>" --label bug --body "<body>"
```

Print the issue number and URL back to the user.

## Step 3: Hand off to the fix

State the issue number, then remind: the fixing PR's body MUST contain `Closes #<number>` so GitHub auto-links the PR and closes the issue on merge. If a fix PR/branch already exists, edit its body to add that line (or `gh issue comment <number>` with the PR link). After the fix lands, the issue closes itself -- no manual close.
