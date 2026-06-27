/**
 * Endpoint treatment for phase-bar borders.
 *
 * Pure (no Angular) so the node unit runner can cover it directly. Import this
 * from phase-bar.component.ts; do not inline the logic in the component.
 */

import {
  DatePrecision,
  isApproximate,
} from '../../../core/models/marker-date-precision';

export type EndpointTreatment = 'hard' | 'cap' | 'feather';

/**
 * Determines how a single phase-bar endpoint renders:
 *
 * - 'feather'  the endpoint is open (no end date / ongoing) or clipped at the
 *              visible window edge. The existing phaseFadeStops mask applies;
 *              "ongoing" stays visually distinct from "approximate".
 * - 'cap'      the endpoint has a known but approximate date (month / quarter /
 *              half / year precision). Render a hollow end-cap (white fill,
 *              phase-colored ring) plus a ~caption below the bar edge.
 * - 'hard'     exact precision or no precision data. Clean stroked bar edge,
 *              no cap, no caption. Exact trials look exactly as they do today.
 *
 * An endpoint is never both: open/clipped always wins over precision so
 * "ongoing" and "approximate" can never collide (spec B5).
 */
export function endpointTreatment(
  isOpen: boolean,
  precision: DatePrecision | null
): EndpointTreatment {
  if (isOpen) return 'feather';
  if (isApproximate(precision)) return 'cap';
  return 'hard';
}
