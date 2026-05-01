import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'clint.engagement-landing.onboarding-tooltip-seen';

/**
 * Tracks whether the one-time "Your timeline is now under the Timeline tab"
 * tooltip should be shown next to the Timeline tab in the topbar. The
 * EngagementLandingComponent calls `requestIfUnseen()` once per page load;
 * the topbar reads `visible()` and calls `dismiss()` when the user closes it
 * or clicks the Timeline tab.
 *
 * Persistence: localStorage flag at `clint.engagement-landing.onboarding-tooltip-seen`.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingTooltipService {
  private readonly _visible = signal(false);
  readonly visible = this._visible.asReadonly();

  /**
   * If the user has not yet seen the tooltip, show it. No-op if already
   * seen or already visible. Safe to call repeatedly.
   */
  requestIfUnseen(): void {
    if (this._visible()) return;
    if (this.hasSeen()) return;
    this._visible.set(true);
  }

  /** Hide and persist the dismissal so the tooltip never returns. */
  dismiss(): void {
    this._visible.set(false);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // localStorage unavailable (private mode etc.); the tooltip will
      // come back next session, which is fine.
    }
  }

  private hasSeen(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return true;
    }
  }
}
