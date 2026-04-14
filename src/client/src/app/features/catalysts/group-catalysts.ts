import { Catalyst, CatalystGroup, FlatCatalyst } from '../../core/models/catalyst.model';

/**
 * Groups a chronologically-sorted list of catalysts into adaptive time buckets.
 * - Current ISO week -> "This Week"
 * - Next ISO week -> "Next Week"
 * - Next 2 calendar months -> monthly ("May 2026")
 * - Beyond that -> quarterly ("Q3 2026")
 */
export function groupCatalystsByTimePeriod(
  catalysts: Catalyst[],
  referenceDate: Date = new Date(),
): CatalystGroup[] {
  const groups = new Map<string, CatalystGroup>();

  for (const catalyst of catalysts) {
    const eventDate = parseDate(catalyst.event_date);
    const bucket = computeBucket(eventDate, referenceDate);

    if (!groups.has(bucket.key)) {
      groups.set(bucket.key, {
        label: bucket.label,
        date_range: bucket.dateRange,
        catalysts: [],
      });
    }
    groups.get(bucket.key)!.catalysts.push(catalyst);
  }

  return Array.from(groups.values());
}

/**
 * Flattens grouped catalysts back into a flat array with time_bucket fields
 * for use with PrimeNG p-table rowGroupMode="subheader".
 */
export function flattenGroupedCatalysts(groups: CatalystGroup[]): FlatCatalyst[] {
  return groups.flatMap((g) =>
    g.catalysts.map((c) => ({
      ...c,
      time_bucket: g.label,
      time_bucket_range: g.date_range,
    })),
  );
}

interface Bucket {
  key: string;
  label: string;
  dateRange: string;
}

function computeBucket(eventDate: Date, referenceDate: Date): Bucket {
  const refWeekStart = getISOWeekStart(referenceDate);
  const refWeekEnd = addDays(refWeekStart, 6);
  const nextWeekStart = addDays(refWeekStart, 7);
  const nextWeekEnd = addDays(refWeekStart, 13);

  // This Week
  if (eventDate >= refWeekStart && eventDate <= refWeekEnd) {
    return {
      key: `week-this`,
      label: 'This Week',
      dateRange: `${formatShort(refWeekStart)}\u2013${formatShort(refWeekEnd)}`,
    };
  }

  // Next Week
  if (eventDate >= nextWeekStart && eventDate <= nextWeekEnd) {
    return {
      key: `week-next`,
      label: 'Next Week',
      dateRange: `${formatShort(nextWeekStart)}\u2013${formatShort(nextWeekEnd)}`,
    };
  }

  // Monthly: within 2 calendar months after the reference month
  const monthBoundary = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 3,
    0,
  );
  if (eventDate <= monthBoundary) {
    const monthLabel = eventDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    return {
      key: `month-${eventDate.getFullYear()}-${eventDate.getMonth()}`,
      label: monthLabel,
      dateRange: '',
    };
  }

  // Quarterly
  const quarter = Math.floor(eventDate.getMonth() / 3) + 1;
  return {
    key: `quarter-${eventDate.getFullYear()}-Q${quarter}`,
    label: `Q${quarter} ${eventDate.getFullYear()}`,
    dateRange: '',
  };
}

function getISOWeekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = start of ISO week
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseDate(dateStr: string): Date {
  // Parse YYYY-MM-DD without timezone shift
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
