import { animate, query, style, transition, trigger } from '@angular/animations';

/**
 * Fade-in animation for route transitions.
 * Bind to a value that changes on navigation (e.g., outlet route path).
 * The entering component fades in; the leaving component exits instantly.
 */
export const routeFadeAnimation = trigger('routeFade', [
  transition('* <=> *', [
    query(
      ':enter',
      [
        style({ opacity: 0 }),
        animate('200ms cubic-bezier(0.25, 1, 0.5, 1)', style({ opacity: 1 })),
      ],
      { optional: true }
    ),
  ]),
]);
