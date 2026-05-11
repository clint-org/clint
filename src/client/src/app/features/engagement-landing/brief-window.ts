export type BriefWindow = 'THIS WEEK' | 'THIS MONTH' | 'NEXT QUARTER';

export interface BriefInput {
  marker_id: string;
  event_date: string;
  title: string;
  company_name: string | null;
}

export interface BriefResult {
  window: BriefWindow;
  lead: BriefInput;
  additional: number;
}

const MS_PER_DAY = 86_400_000;

function daysUntil(eventDate: string, now: Date): number {
  const event = new Date(eventDate + 'T00:00:00Z').getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((event - today) / MS_PER_DAY);
}

function windowDays(window: BriefWindow): number {
  if (window === 'THIS WEEK') return 7;
  if (window === 'THIS MONTH') return 30;
  return 90;
}

export function computeBrief(list: readonly BriefInput[], now: Date): BriefResult | null {
  const future = list.filter((c) => daysUntil(c.event_date, now) >= 0);
  if (future.length === 0) return null;
  const lead = future[0];
  const leadDays = daysUntil(lead.event_date, now);
  let window: BriefWindow;
  if (leadDays <= 7) window = 'THIS WEEK';
  else if (leadDays <= 30) window = 'THIS MONTH';
  else if (leadDays <= 90) window = 'NEXT QUARTER';
  else return null;
  const cap = windowDays(window);
  const sameWindow = future.filter((c) => daysUntil(c.event_date, now) <= cap);
  return { window, lead, additional: sameWindow.length - 1 };
}
