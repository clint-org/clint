import { Company } from '../../core/models/company.model';
import { Marker } from '../../core/models/marker.model';
import { Trial } from '../../core/models/trial.model';
import { Asset } from '../../core/models/asset.model';
import { UpcomingCatalyst } from './engagement-landing.service';

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Flatten the company > asset > trial hierarchy to the "Next N days" upcoming-events
 * list. Events exist at every anchor level: company-anchored (company.events),
 * asset-anchored (asset.events), and trial-anchored (trial.markers). Collect all three
 * so this panel matches the backend landing-stats 90d count, which counts events with no
 * anchor filter. (Previously this walked only trial.markers, so an asset/company future
 * event was dropped here while the stat bar counted it.) Pure + exported for unit
 * coverage.
 */
export function extractUpcoming(companies: Company[], windowDays: number): UpcomingCatalyst[] {
  const today = todayIso();
  const horizon = addDaysIso(windowDays);
  const out: UpcomingCatalyst[] = [];

  const pushIfInWindow = (
    marker: Marker,
    ctx: { company: Company; asset?: Asset; trial?: Trial }
  ): void => {
    if (!marker.event_date) return;
    if (marker.event_date < today || marker.event_date > horizon) return;
    const mt = marker.marker_types;
    out.push({
      marker_id: marker.id,
      title: marker.title ?? mt?.name ?? 'Event',
      event_date: marker.event_date,
      is_projected: marker.is_projected,
      no_longer_expected: marker.no_longer_expected,
      category_name: mt?.marker_categories?.name ?? '',
      marker_type_color: mt?.color ?? '',
      marker_type_shape: mt?.shape ?? 'circle',
      marker_type_fill_style: mt?.fill_style ?? 'filled',
      marker_type_inner_mark: mt?.inner_mark ?? 'none',
      company_name: ctx.company.name,
      asset_name: ctx.asset?.name ?? null,
      trial_name: ctx.trial?.name ?? null,
      trial_acronym: ctx.trial?.acronym ?? null,
    });
  };

  for (const company of companies) {
    for (const marker of company.events ?? ([] as Marker[])) {
      pushIfInWindow(marker, { company });
    }
    for (const asset of company.assets ?? ([] as Asset[])) {
      for (const marker of asset.events ?? ([] as Marker[])) {
        pushIfInWindow(marker, { company, asset });
      }
      for (const trial of asset.trials ?? ([] as Trial[])) {
        for (const marker of trial.markers ?? ([] as Marker[])) {
          pushIfInWindow(marker, { company, asset, trial });
        }
      }
    }
  }

  out.sort((a, b) => a.event_date.localeCompare(b.event_date) || a.title.localeCompare(b.title));
  return out;
}
