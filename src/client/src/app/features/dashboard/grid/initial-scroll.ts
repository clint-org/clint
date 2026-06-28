export interface InitialScrollInput {
  /** Pixel x-position of "today" within the timeline content. */
  todayX: number;
  /** Pixel x-position of the latest event in the data. */
  lastEventX: number;
  /** Width of the scroll viewport (container clientWidth). */
  viewportWidth: number;
  /** Total scrollable content width (the timeline's full width). */
  contentWidth: number;
}

/** Fraction of the viewport that "today" sits in from the left edge. */
const TODAY_LEFT_FRACTION = 1 / 3;

/** Where the latest event is held when there is no activity near today. */
const LAST_EVENT_RIGHT_FRACTION = 0.9;

/**
 * Initial horizontal scroll offset for a timeline, anchored on "today".
 *
 * Lands with today about a third from the left so recent past and upcoming
 * catalysts are both in view. For past-heavy data (no activity near today) the
 * target is pulled back so the latest event stays near the right edge instead of
 * parking the viewport on empty space to the right of it. The result is always
 * clamped to a valid scroll position.
 */
export function computeInitialScrollLeft(input: InitialScrollInput): number {
  const { todayX, lastEventX, viewportWidth, contentWidth } = input;
  const maxScroll = Math.max(0, contentWidth - viewportWidth);

  const preferred = todayX - viewportWidth * TODAY_LEFT_FRACTION;
  const keepLastVisible = lastEventX - viewportWidth * LAST_EVENT_RIGHT_FRACTION;

  const target = Math.min(preferred, keepLastVisible);
  return Math.max(0, Math.min(maxScroll, target));
}
