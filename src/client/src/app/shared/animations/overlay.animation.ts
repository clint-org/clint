import { animate, style, transition, trigger } from '@angular/animations';

/** Simple opacity fade for backdrops. */
export const backdropFadeAnimation = trigger('backdropFade', [
  transition(':enter', [style({ opacity: 0 }), animate('150ms ease-out', style({ opacity: 1 }))]),
  transition(':leave', [animate('100ms ease-in', style({ opacity: 0 }))]),
]);

/** Fade + slide up for menus appearing from below a trigger (e.g., account menu). */
export const menuSlideUpAnimation = trigger('menuSlideUp', [
  transition(':enter', [
    style({ opacity: 0, transform: 'translateY(8px)' }),
    animate(
      '150ms cubic-bezier(0.25, 1, 0.5, 1)',
      style({ opacity: 1, transform: 'translateY(0)' })
    ),
  ]),
  transition(':leave', [
    animate('100ms ease-in', style({ opacity: 0, transform: 'translateY(8px)' })),
  ]),
]);

