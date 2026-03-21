import { Page } from '@playwright/test';

/**
 * Fill an Angular form field reliably.
 *
 * Playwright events don't trigger Angular's ngModel/signal updates.
 * This helper uses Angular's debug API to find the owning component
 * and directly updates the model (signal.set() or property assignment).
 *
 * Only works in dev mode (ng serve).
 */
export async function fillInput(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).waitFor({ state: 'visible', timeout: 5000 });

  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
      if (!el) throw new Error(`Element not found: ${sel}`);

      // Set the DOM value
      el.value = val;

      // Find the Angular component
      const ng = (window as any).ng;
      if (!ng?.getOwningComponent) {
        throw new Error('Angular debug API not available');
      }

      const component = ng.getOwningComponent(el);
      if (!component) {
        throw new Error(`No Angular component found for: ${sel}`);
      }

      // Strategy 1: Try to find the ngModel binding name from the element's attributes
      // Angular sets ng-reflect-name on inputs with [(ngModel)]
      const ngModelName = el.getAttribute('ng-reflect-name');

      // Strategy 2: Map input id to signal/property names
      const id = el.id;
      const candidates = getPropertyCandidates(id, ngModelName);

      let updated = false;
      for (const name of candidates) {
        const prop = component[name];
        if (prop === undefined) continue;

        if (typeof prop === 'function' && prop.set) {
          // It's a signal
          prop.set(val);
          updated = true;
          break;
        } else if (typeof prop === 'string' || prop === null || prop === '') {
          // It's a plain property
          component[name] = val;
          updated = true;
          break;
        }
      }

      if (!updated) {
        // Fallback: try all string/signal properties
        for (const key of Object.keys(component)) {
          if (key.startsWith('_') || key.startsWith('__')) continue;
          const prop = component[key];
          if (typeof prop === 'function' && prop.set) {
            try {
              const cur = prop();
              if (typeof cur === 'string' && cur === '') {
                prop.set(val);
                updated = true;
                break;
              }
            } catch {}
          }
        }
      }

      // Dispatch events for form state and trigger Angular change detection
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      // Force Angular to run change detection
      const appRef = ng.getComponent(document.querySelector('app-root'));
      if (appRef) {
        try {
          // Angular's ApplicationRef.tick() forces change detection
          const injector = (window as any).getAllAngularTestabilities?.()[0];
          if (injector) {
            injector.whenStable(() => {});
          }
        } catch {}
      }

      function getPropertyCandidates(inputId: string, modelName: string | null): string[] {
        const names: string[] = [];

        // Direct model name from [(ngModel)]
        if (modelName) {
          names.push(modelName);
          // Try with 'new' prefix for newSpaceName etc.
          names.push('new' + modelName.charAt(0).toUpperCase() + modelName.slice(1));
        }

        // Parse input ID: 'company-name' -> try 'name', 'companyName'
        const parts = inputId.split('-');
        for (let i = 0; i < parts.length; i++) {
          const camel = parts
            .slice(i)
            .map((p, j) => (j === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
            .join('');
          names.push(camel);
        }

        // Full camelCase of entire ID
        const fullCamel = parts
          .map((p, j) => (j === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
          .join('');
        names.push(fullCamel);

        // Common short names
        if (inputId.includes('name')) names.push('name');
        if (inputId.includes('content')) names.push('content');

        return [...new Set(names)];
      }
    },
    { sel: selector, val: value },
  );
}

export async function clearAndFill(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  await fillInput(page, selector, value);
}
