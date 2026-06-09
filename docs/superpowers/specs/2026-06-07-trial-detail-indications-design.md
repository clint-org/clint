# Trial detail: show assigned indications

## Problem

Trials can now have indications assigned and persisted (via the
`set_trial_indications` / `get_trial_indications` RPCs and the functional
multi-indication selects in the trial create/edit dialogs). But the trial
**detail** page does not display them. A user who assigns indications has no
read-only place to confirm them outside the edit dialog.

This closes the display half of the trial-indications work. The save half is
already shipped.

## Goal

Surface a trial's assigned indications read-only on the trial detail page,
consistent with how the other trial attributes are presented.

## Non-goals

- No inline editing on the detail page. Editing stays in the trial edit
  dialog, matching how Asset and Status are presented (read-only here).
- Do **not** show the asset's MOA / ROA on the trial detail page. Those are
  asset-level attributes, identical across every trial of the asset, already
  rendered on the asset detail page one click away. They are not trial-level
  signal and would require bloating the shared `TRIAL_SELECT`.

## Design

### Data load

`getById`'s `TRIAL_SELECT` joins only `assets(id, name, companies(...))`; it
does not pull indications. Rather than extend that shared select (also used by
the list fetches), load indications with the existing
`trialService.listIndications(trialId)` RPC the edit dialog already uses.

In `TrialDetailComponent`:

- Add `readonly indications = signal<{ id: string; name: string }[]>([])`.
- In `loadTrial()`, after the trial resolves, fetch indications via
  `listIndications(this.trialId())` and set the signal. A failure to load
  indications must not break the page (the trial still renders) -- catch and
  leave the signal empty. Reset the signal to `[]` at the start of each
  `loadTrial()` so stale indications never carry across in-place navigation
  between trials.

### Placement and render

Add an **Indications** cell to the existing "Basic info" definition list
(`trial-detail.component.html`), immediately after the "Asset" cell. Render
each indication as a small chip mirroring the MOA/ROA idiom on the asset
detail header:

```
class="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5"
```

When no indications are assigned, show `--`, consistent with the other empty
cells in that definition list.

```
Basic info
  STATUS        ASSET            INDICATIONS              DISPLAY ORDER
  [Recruiting]  Pembrolizumab    [NSCLC] [Melanoma]       3
```

## Testing

Pair the change with a focused spec for `TrialDetailComponent` that:

- Mocks `TrialService.listIndications` to return a known set.
- Asserts `loadTrial()` populates the `indications` signal from the service.
- Asserts the signal resets to `[]` before each load (no stale carryover) and
  stays `[]` when the service throws.

The existing detail-component test harness pattern in the repo will be
confirmed during planning; if no lightweight harness exists for these
heavily-injected detail components, test the loading/reset logic at the
smallest seam that exercises it.

## Verification

```bash
cd src/client && ng lint && ng build
npm run test:units
```

Exercise the trial detail page in a browser: a trial with indications shows
the chips; a trial with none shows `--`; switching between trials via an
in-place LINKED chip updates the indication chips correctly.
