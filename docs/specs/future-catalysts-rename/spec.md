# Future Catalysts rename

## Goal

Rename the "Catalysts" UI label to "Future Catalysts" everywhere it appears in the app. The renamed label makes the present-vs-future scope explicit and aligns with the locked terminology decision: a *marker* is the database entity; a *future catalyst* is the UI concept for future-dated markers in clinical / regulatory / approval / data categories.

This is a small, isolated rename. Cosmetic only -- no schema or routing change beyond the label.

## Scope

- Rename "Catalysts" to "Future Catalysts" in the landscape shell tab.
- Rename "Catalyst feed" / "Catalysts list" headings on the catalysts page.
- Rename references in the runbook docs.
- Update any other in-app text that says "Catalysts" referring to the future-only feed.
- Leave the route path as-is (`/catalysts`) for bookmark stability.
- Leave the database / RPC names as-is (`get_dashboard_data`, `markers` table, etc.). The rename is UI text only.

Not in scope:
- Renaming the markers table (already locked: stays `markers`).
- Renaming the route (`/catalysts` stays).
- Adding a "Past Catalysts" or any past-catalysts feature.

## Files touched

Frontend:
- Landscape shell tab labels: wherever the four-tab nav (Timeline / Bullseye / Positioning / Catalysts) is defined.
- Catalysts page heading and meta text.
- Any component templates with the literal string "Catalysts" in user-visible text.

Docs:
- `docs/runbook/03-features.md` -- update mentions of the "Catalysts" tab.
- Any other docs that reference the user-facing label.

## Test plan

1. Click the renamed tab; the catalysts page still loads.
2. Page heading reads "Future Catalysts".
3. Direct visit to `/t/:tenant/s/:space/catalysts` still works (route unchanged).
4. Search the codebase for "Catalysts" (capital C) in templates and components; verify no regressions.
5. Lint and build pass.

## Branch

`feat/future-catalysts-rename`. One PR. Estimated diff: 30-80 lines (label changes across templates and runbook).
