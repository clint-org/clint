/**
 * Entity write path through the browser (not just RPC seeding): an editor
 * creates a company via the dialog, sees the row, then deletes it through the
 * cascade-confirm dialog. Fresh world per test so the write is isolated.
 */
import { test, expect } from '../fixtures';

test.use({ worldRoles: ['editor'] });

test.describe('@crud company create + delete', () => {
  test('editor creates then deletes a company', async ({ world, pageAs, gotoSettled }) => {
    const page = await pageAs('editor');
    await gotoSettled(page, `/t/${world.tenantId}/s/${world.spaceId}/profiles/companies`);

    const name = `Spec Co ${world.id}`;

    // create via the dialog
    await page.getByRole('button', { name: /add compan/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').first().fill(name);
    await dialog
      .getByRole('button', { name: /create|save|add/i })
      .first()
      .click();

    // row appears
    await expect(page.getByText(name)).toBeVisible();

    // delete through the row action -> cascade-confirm dialog
    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button').last().click();
    await page.getByRole('menuitem', { name: /delete|remove/i }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    // cascade-confirm requires typing the entity name to enable the delete button
    const confirmInput = confirm.getByRole('textbox');
    if (await confirmInput.count()) await confirmInput.first().fill(name);
    const delBtn = confirm.getByRole('button', { name: /delete|confirm|remove/i }).first();
    await expect(delBtn).toBeEnabled();
    await delBtn.click();

    // row is gone
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
