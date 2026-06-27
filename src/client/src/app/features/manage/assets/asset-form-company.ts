/**
 * Resolves the company to pre-select when *creating* a new asset.
 *
 * When the create form is opened from a company's detail page the company is
 * locked, so it always wins. Otherwise we default to the first company in the
 * list (the long-standing convenience), falling back to '' when the space has
 * no companies yet -- matching the `companyId` signal's initial value.
 *
 * Edit mode does not use this helper: the existing asset's company is set
 * directly from the loaded record.
 */
export interface CreateCompanyArgs {
  lockedCompanyId: string | null;
  companyIds: string[];
}

export function resolveCreateCompanyId({ lockedCompanyId, companyIds }: CreateCompanyArgs): string {
  return lockedCompanyId ?? companyIds[0] ?? '';
}
