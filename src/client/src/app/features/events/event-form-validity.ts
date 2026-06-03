/**
 * Pure validity check for the event form's required fields.
 *
 * An event needs a title, an event date, and a category before it can be
 * created or updated. Kept as a standalone predicate (mirroring
 * format-event-date-suffix.ts) so the gate can be unit-tested without
 * compiling the component template, and so the component's `canSubmit`
 * computed and the submit guard share one source of truth.
 */
export function isEventFormComplete(
  title: string,
  eventDate: Date | null,
  categoryId: string
): boolean {
  return title.trim().length > 0 && eventDate !== null && categoryId.trim().length > 0;
}
