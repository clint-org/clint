/**
 * AI cost / token accounting. Triggers a REAL extraction against the deployed-dev
 * worker (POST {host}/api/source/extract -- the same endpoint the import UI hits,
 * import-page.component.ts:502) and verifies the full cost+token trail:
 *   (a) ai_calls records non-null tokens + a cost computed SERVER-SIDE in
 *       ai_call_close from the model's catalog price (NOT a worker-sent number);
 *   (b) the per-space rollup sums it (pooler cross-check), and the
 *       /super-admin/ai-usage console aggregates it (UI, @admin).
 *
 * Cost formula (ai_estimate_cost_cents, migration 20260624150000):
 *   cents = round(prompt_tokens/1e6 * input_cents_per_mtok
 *               + completion_tokens/1e6 * output_cents_per_mtok, 4)
 * Catalog seed (cents per Mtok): opus 500/2500, sonnet 300/1500, haiku 100/500.
 *
 * @external -- spends one live Claude call; isolate so AI latency never fails the
 * core suite. ai_calls is agency/platform-admin RLS-gated, so role-user apiAs
 * SELECT is blocked -> we read it via the write-capable pooler (bypasses RLS).
 *
 * Sources: ai_calls schema 20260526100200; server-side cost 20260624150100;
 * pricing 20260624150000; rollup 20260526101000; console super-admin-ai-usage.component.ts.
 */
import { test, expect, createScratchWorld, settle, userFor, type ScratchWorld } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';
import {
  triggerSourceExtract,
  selectAiCall,
  selectAiCallsForSpace,
  modelPricing,
  dbEstimateCostCents,
  expectedCostCents,
  type AiCallRow,
} from '../helpers/ai-usage';
import { sessionCookie } from '../helpers/auth-cookie';
import { enableAi } from '../helpers/ai-config';
// superAdminPageAs is OWNED by the admin-portals area (platform-admin session on a
// super-admin host). Reference it; do not redefine. If it/the host is unavailable
// the @admin test skips and the pooler assertions above still prove the accounting.
import { superAdminPageAs } from '../helpers/admin-context';

// A short pharma press release: enough signal for the model to emit tokens. Unique
// per world so the worker's text-hash duplicate guard never short-circuits it.
const pressRelease = (id: string): string =>
  `Acme Pharma (run ${id}) today announced topline results from ACME-301, a Phase 3 ` +
  `randomized trial of acmemab, a GLP-1 receptor agonist, in adults with obesity. ` +
  `The trial met its primary endpoint of percent change in body weight at week 68. ` +
  `Acme plans to submit a BLA to the FDA in the second half of the year. ` +
  `acmemab is administered subcutaneously once weekly.`;

async function pollClosed(aiCallId: string): Promise<AiCallRow> {
  // The worker closes the call before responding 200, so the row is usually
  // terminal immediately; poll briefly for resilience.
  for (let i = 0; i < 12; i++) {
    const row = await selectAiCall(aiCallId);
    if (row && row.outcome !== 'pending') return row;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const row = await selectAiCall(aiCallId);
  if (!row) throw new Error(`ai_call ${aiCallId} never appeared in ai_calls`);
  return row;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe.configure({ mode: 'serial' });

// SCAFFOLD (test.fixme): authored + grounded; pending a headed verification pass. Spends a real
// Anthropic call and needs the super-admin host (admin.dev.clintapp.com, confirmed kind
// 'super-admin') for the console-aggregation test. Pooler-level ai_calls cost assertions are
// the load-bearing ones; verify headed before enabling.
test.describe('@external AI cost + token accounting', () => {
  let world: ScratchWorld;
  let model: string;
  let aiCallId: string;
  let row: AiCallRow;
  let extractCtx: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    world = await createScratchWorld(); // owner only -- the extract runs as owner
    // Use the product's default model so we exercise the real production path and
    // minimize the chance the model-id is unprovisioned at the dev API key.
    model = await enableAi(world, 'claude-sonnet-4-6');

    // The worker /api is behind Cloudflare on dev; a bare Node fetch is 403'd. Run
    // the extract from a real Chrome page that has cleared the challenge (same path
    // the import UI takes). `browser` is worker-scoped, so it is available here.
    extractCtx = await browser.newContext({ baseURL: world.baseURL });
    await extractCtx.addCookies([sessionCookie(userFor(world, 'owner').session)]);
    const page: Page = await extractCtx.newPage();
    await settle(page, `/t/${world.tenantId}/s/${world.spaceId}`); // clears Cloudflare

    const { status, body } = await triggerSourceExtract(page, world, 'owner', pressRelease(world.id));
    expect(status, `extract did not return 200: ${JSON.stringify(body)}`).toBe(200);
    aiCallId = body['ai_call_id'] as string;
    expect(aiCallId, 'worker should return an ai_call_id on success').toBeTruthy();

    row = await pollClosed(aiCallId);
  });

  test.afterAll(async () => {
    await extractCtx?.close().catch(() => {});
    await world?.cleanup();
  });

  test('ai_calls records non-null tokens and a server-side cost matching the catalog formula', async () => {
    // VERIFY: outcome=success assumes dev ANTHROPIC_API_KEY is set AND the catalog
    // model-id resolves at the Anthropic API. If the API errors, the worker closes
    // with parse_failed/timeout and tokens stay 0 -> this assertion flags that gap.
    expect(row.outcome, `unexpected outcome (row=${JSON.stringify(row)})`).toBe('success');

    expect(row.prompt_tokens, 'prompt_tokens should be recorded').not.toBeNull();
    expect(row.prompt_tokens as number).toBeGreaterThan(0);
    expect(row.completion_tokens, 'completion_tokens should be recorded').not.toBeNull();
    expect(row.cost_estimate_cents, 'cost_estimate_cents should be recorded').not.toBeNull();
    // ai_call_open stamps the tenant's configured model (ai_call_open:32-37).
    expect(row.model).toBe(model);

    const pt = row.prompt_tokens as number;
    const ct = row.completion_tokens as number;
    const stored = Number(row.cost_estimate_cents);

    // 1. Equality against the DB's own helper (what actually wrote the row).
    const dbCost = await dbEstimateCostCents(row.model, pt, ct);
    expect(stored).toBeCloseTo(dbCost, 4);

    // 2. Equality against the formula recomputed in JS from the catalog price,
    //    proving we understand input/output token pricing for this model.
    const pricing = await modelPricing(row.model);
    expect(pricing, `no ai_model_pricing row for ${row.model}`).not.toBeNull();
    const jsCost = expectedCostCents(pt, ct, pricing!);
    expect(stored).toBeCloseTo(jsCost, 4);

    // A real successful extraction always has prompt tokens, so cost is > 0.
    expect(stored).toBeGreaterThan(0);
  });

  test('per-space rollup sums the call (pooler cross-check)', async () => {
    const calls = await selectAiCallsForSpace(world.spaceId);
    expect(
      calls.some((c) => c.id === aiCallId),
      'the call is attributed to the scratch space'
    ).toBe(true);
    const sum = calls.reduce((acc, c) => acc + Number(c.cost_estimate_cents ?? 0), 0);
    expect(sum, 'space-level cost sum includes the call').toBeGreaterThan(0);
  });

  test('@admin super-admin AI usage console aggregates the import', async ({ browser }) => {
    let page;
    try {
      // Owned by admin-portals: platform-admin session on a super-admin host.
      ({ page } = await superAdminPageAs(browser, world));
    } catch (e) {
      test.skip(true, `super-admin host/auth unavailable (admin-portals helper): ${String(e)}`);
      return;
    }

    // Console opens at platform scope (tenant rows), default 30-day window
    // (super-admin-ai-usage.component.ts: windowDays=30, scope='tenants').
    await settle(page, '/super-admin/ai-usage');

    const tenantName = `PW Reg Tenant ${world.id}`; // provision_tenant p_name (scratch-world.ts:219)
    // The aria-label sits on the <p-table> host, which PrimeNG does NOT render as a
    // role=table element -> match by accessible name with getByLabel, not getByRole.
    // Only one scope's p-table is in the DOM at a time (@if scope() === ...), so the
    // row lookups below are page-level and unambiguous.
    await expect(page.getByLabel('AI usage by tenant')).toBeVisible({ timeout: 20000 });

    // The tenant must appear (the rollup counted our import for it).
    const tenantRow = page.getByRole('row', { name: new RegExp(escapeRegExp(tenantName)) });
    await expect(tenantRow).toBeVisible();

    // Drill platform -> spaces (row click, component.ts:198 (click)=drillToSpaces).
    await tenantRow.click();
    const spaceName = `PW Reg Space ${world.id}`; // create_space p_name (scratch-world.ts:227)
    await expect(page.getByLabel('AI usage by space')).toBeVisible({ timeout: 15000 });
    const spaceRow = page.getByRole('row', { name: new RegExp(escapeRegExp(spaceName)) });
    await expect(spaceRow).toBeVisible();

    // Drill spaces -> imports (component.ts:268 (click)=drillToImports).
    await spaceRow.click();
    // exact: true so the table's "Import details" label does not also match the
    // per-row "Show import details" expand button (substring collision).
    const importsTable = page.getByLabel('Import details', { exact: true }); // component.ts:298
    await expect(importsTable).toBeVisible({ timeout: 15000 });
    // Outcome badge renders the literal outcome text (component.ts:361).
    await expect(page.getByText('success', { exact: false }).first()).toBeVisible();

    // Best-effort precise cost: expand the row (toggle button aria-label
    // "Show import details", component.ts:321) and read the Tokens line
    // ("N in / N out", component.ts:382-383) which must match the DB row. Page-level
    // (not scoped to the labeled table) and guarded, since source_title may be blank
    // for a text paste, making row-targeting ambiguous.
    const expandBtn = page.getByRole('button', { name: /show import details/i }).first();
    if (await expandBtn.count()) {
      await expandBtn.click();
      const inTokens = (row.prompt_tokens as number).toLocaleString('en-US');
      await expect(page.getByText(`${inTokens} in`, { exact: false }).first()).toBeVisible();
    }
  });
});
