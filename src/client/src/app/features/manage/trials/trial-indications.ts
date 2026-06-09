/**
 * Trial indications are supplementary context on the trial detail page; a
 * failed fetch must never blank the whole page. This helper runs the fetcher
 * and swallows any error into an empty list, keeping that silent-failure
 * contract in one unit-tested place (the component renders in a plain-node
 * test env with no TestBed, so the logic lives here, not in the component).
 */
export async function fetchIndicationsSafe(
  fetcher: () => Promise<{ id: string; name: string }[]>
): Promise<{ id: string; name: string }[]> {
  try {
    return await fetcher();
  } catch {
    return [];
  }
}
