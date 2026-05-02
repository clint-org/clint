import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';

import {
  IntelligencePayload,
  PrimaryIntelligenceRevision,
} from '../../../core/models/primary-intelligence.model';

type ActivityCategory = 'read' | 'linked' | 'marker' | 'material';

interface ActivityEntry {
  id: string;
  category: ActivityCategory;
  pillLabel: string;
  subject: string;
  changeNote: string | null;
  authorInitials: string;
  timestamp: string;
}

/**
 * Recent activity feed for an entity. v1 ships read events derived from
 * primary_intelligence_revisions. linked / marker / material categories
 * are placeholders -- they render their own sections with a small "no
 * recent activity" message until later branches wire them up.
 */
@Component({
  selector: 'app-recent-activity-feed',
  standalone: true,
  imports: [DatePipe],
  template: `
    <section class="mb-4 border border-slate-200 bg-white">
      <header
        class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2"
      >
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Recent activity
        </h2>
        <span class="font-mono text-[10px] text-slate-400">{{ entries().length }} events</span>
      </header>
      <div class="px-4 py-3">
        @if (entries().length === 0) {
          <p class="text-xs text-slate-400">No recent activity yet.</p>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (entry of entries(); track entry.id) {
              <li class="py-2.5">
                <div class="flex flex-wrap items-center gap-2">
                  <span [class]="pillClass(entry.category)">{{ entry.pillLabel }}</span>
                  <span class="text-sm text-slate-700">{{ entry.subject }}</span>
                  <span class="ml-auto font-mono text-[11px] text-slate-400 tabular-nums">
                    {{ entry.timestamp | date: 'MMM d, y, h:mm a' }}
                  </span>
                </div>
                @if (entry.changeNote) {
                  <p class="mt-1 pl-1 text-xs italic text-slate-500">{{ entry.changeNote }}</p>
                }
                @if (agencyView()) {
                  <p class="mt-0.5 pl-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    {{ entry.authorInitials }}
                  </p>
                }
              </li>
            }
          </ul>
        }

        <div class="mt-4 border-t border-dashed border-slate-200 pt-3 text-[11px] text-slate-400">
          Linked, marker, and material event categories will surface here once each registry ships.
        </div>
      </div>
    </section>
  `,
})
export class RecentActivityFeedComponent {
  readonly published = input<IntelligencePayload | null>(null);
  readonly draft = input<IntelligencePayload | null>(null);
  readonly agencyView = input<boolean>(false);
  readonly authorMap = input<Record<string, string>>({});

  protected readonly entries = computed<ActivityEntry[]>(() => {
    const all: ActivityEntry[] = [];
    const map = this.authorMap();

    const handlePayload = (payload: IntelligencePayload | null): void => {
      if (!payload) return;
      const revs = [...(payload.recent_revisions ?? [])].sort(
        (a, b) => +new Date(b.edited_at) - +new Date(a.edited_at)
      );
      revs.forEach((rev, index) => {
        all.push(buildReadEntry(rev, index === revs.length - 1, payload, map));
      });
    };

    handlePayload(this.published());
    if (this.agencyView()) handlePayload(this.draft());

    // de-dupe by revision id (published + draft can share one)
    const seen = new Set<string>();
    const deduped = all.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    return deduped.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  });

  protected pillClass(category: ActivityCategory): string {
    const base =
      'rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider border';
    switch (category) {
      case 'read':
        return `${base} border-brand-200 bg-brand-50 text-brand-700`;
      case 'linked':
        return `${base} border-slate-200 bg-slate-50 text-slate-600`;
      case 'marker':
        return `${base} border-green-200 bg-green-50 text-green-700`;
      case 'material':
        return `${base} border-amber-200 bg-amber-50 text-amber-700`;
      default:
        return base;
    }
  }
}

function buildReadEntry(
  rev: PrimaryIntelligenceRevision,
  isOldest: boolean,
  payload: IntelligencePayload,
  authorMap: Record<string, string>
): ActivityEntry {
  let pill = 'Read revised';
  let subject = 'Read revised';
  if (rev.state === 'published' && payload.record.state === 'published') {
    pill = 'Read published';
    subject = `"${rev.headline}" published`;
  } else if (isOldest) {
    pill = 'Read created';
    subject = `Created draft: "${rev.headline}"`;
  } else {
    pill = 'Read revised';
    subject = `Revised: "${rev.headline}"`;
  }

  return {
    id: rev.id,
    category: 'read',
    pillLabel: pill,
    subject,
    changeNote: rev.change_note,
    authorInitials: authorMap[rev.edited_by] ?? rev.edited_by.slice(0, 2).toUpperCase(),
    timestamp: rev.edited_at,
  };
}
