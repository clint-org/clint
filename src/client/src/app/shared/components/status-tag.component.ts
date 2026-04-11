import { Component, computed, input } from '@angular/core';

type TagTone = 'neutral' | 'teal' | 'amber' | 'slate';

interface TagStyle {
  readonly background: string;
  readonly text: string;
  readonly border: string;
}

const TONES: Record<TagTone, TagStyle> = {
  neutral: {
    background: 'rgb(241 245 249)', // slate-100
    text: 'rgb(71 85 105)', // slate-600
    border: 'rgb(226 232 240)', // slate-200
  },
  teal: {
    background: 'rgb(240 253 250)', // teal-50
    text: 'rgb(15 118 110)', // teal-700
    border: 'rgb(153 246 228)', // teal-200
  },
  amber: {
    background: 'rgb(254 243 199)', // amber-100
    text: 'rgb(146 64 14)', // amber-800
    border: 'rgb(253 230 138)', // amber-200
  },
  slate: {
    background: 'rgb(248 250 252)', // slate-50
    text: 'rgb(100 116 139)', // slate-500
    border: 'rgb(226 232 240)', // slate-200
  },
};

/**
 * Recognised clinical-trial status strings mapped to a brand-safe tone.
 * The brand allows amber only for caution/status cases; teal is reserved
 * for active/pivotal states.
 */
const TRIAL_STATUS_TONE: Record<string, TagTone> = {
  recruiting: 'teal',
  'active, not recruiting': 'teal',
  active: 'teal',
  enrolling: 'teal',
  'enrolling by invitation': 'teal',
  'not yet recruiting': 'amber',
  suspended: 'amber',
  'on hold': 'amber',
  completed: 'slate',
  terminated: 'slate',
  withdrawn: 'slate',
  'unknown status': 'slate',
  unknown: 'slate',
};

@Component({
  selector: 'app-status-tag',
  standalone: true,
  template: `
    @if (label(); as text) {
      <span
        class="status-tag"
        [style.background-color]="resolved().background"
        [style.color]="resolved().text"
        [style.border-color]="resolved().border"
      >
        {{ text }}
      </span>
    } @else {
      <span class="status-tag-empty">--</span>
    }
  `,
  styles: [
    `
      .status-tag {
        display: inline-flex;
        align-items: center;
        padding: 0.0625rem 0.375rem;
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border: 1px solid;
        border-radius: 2px;
        line-height: 1.4;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .status-tag-empty {
        color: rgb(148 163 184);
        font-size: 12px;
      }
    `,
  ],
})
export class StatusTagComponent {
  /** The raw status string to render. Null / empty renders a muted dash. */
  readonly label = input<string | null | undefined>(null);

  /** Optional explicit tone override. If not set, auto-resolves from label. */
  readonly tone = input<TagTone | null>(null);

  readonly resolved = computed<TagStyle>(() => {
    const explicit = this.tone();
    if (explicit) return TONES[explicit];
    const raw = (this.label() ?? '').trim().toLowerCase();
    const mapped = TRIAL_STATUS_TONE[raw] ?? 'neutral';
    return TONES[mapped];
  });
}
