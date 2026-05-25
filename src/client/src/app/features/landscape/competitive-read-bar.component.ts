import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  BullseyeSpoke,
  RING_DEV_RANK,
  RingPhase,
  SpokeGrouping,
} from '../../core/models/landscape.model';

interface SpokeStats {
  spoke: BullseyeSpoke;
  launched: number;
  approved: number;
  p3: number;
  lateStage: number;
  total: number;
  recentActivity: number;
  highestPhase: RingPhase;
}

@Component({
  selector: 'app-competitive-read-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (readText()) {
      <div class="read-bar">
        <span class="read-label">READ</span>
        <span class="read-content" [innerHTML]="readText()"></span>
      </div>
    }
  `,
  styles: `
    .read-bar {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 10px 24px;
      background: white;
      border-bottom: 1px solid var(--slate-200, #e2e8f0);
    }

    .read-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--slate-400, #94a3b8);
      font-family: 'JetBrains Mono', monospace;
      min-width: 72px;
    }

    .read-content {
      font-size: 12px;
      color: var(--slate-600, #475569);
      line-height: 1.6;
    }

    :host ::ng-deep .read-content strong {
      color: var(--slate-800, #1e293b);
      font-weight: 600;
    }

    :host ::ng-deep .read-content strong.leader-name {
      color: var(--teal-600, #0d9488);
    }
  `,
})
export class CompetitiveReadBarComponent {
  readonly spokes = input<BullseyeSpoke[]>([]);
  readonly grouping = input<SpokeGrouping>('company');

  readonly readText = computed<string>(() => {
    const spokeList = this.spokes();
    if (!spokeList.length) return '';

    const stats: SpokeStats[] = spokeList.map((spoke) => {
      let launched = 0;
      let approved = 0;
      let p3 = 0;
      let lateStage = 0;
      let recentActivity = 0;
      let highestPhaseRank = 0;
      let highestPhase: RingPhase = 'PRECLIN';

      for (const asset of spoke.products) {
        if (asset.highest_phase === 'LAUNCHED') launched++;
        if (asset.highest_phase === 'APPROVED') approved++;
        if (asset.highest_phase === 'P3') p3++;
        if (
          RING_DEV_RANK[asset.highest_phase] >= RING_DEV_RANK['P3']
        ) {
          lateStage++;
        }
        if (asset.has_recent_activity) recentActivity++;
        if (asset.highest_phase_rank > highestPhaseRank) {
          highestPhaseRank = asset.highest_phase_rank;
          highestPhase = asset.highest_phase;
        }
      }

      return {
        spoke,
        launched,
        approved,
        p3,
        lateStage,
        total: spoke.products.length,
        recentActivity,
        highestPhase,
      };
    });

    // Sort: launched desc, then late-stage desc, then total desc
    stats.sort((a, b) => {
      if (b.launched !== a.launched) return b.launched - a.launched;
      if (b.lateStage !== a.lateStage) return b.lateStage - a.lateStage;
      return b.total - a.total;
    });

    const parts: string[] = [];

    // Leader: first spoke
    const leader = stats[0];
    const leaderName = `<strong class="leader-name">${this.escapeName(leader.spoke.name)}</strong>`;

    if (leader.launched > 0) {
      parts.push(`${leaderName} leads with ${leader.launched} launched`);
    } else if (leader.approved > 0) {
      parts.push(`${leaderName} leads with ${leader.approved} approved`);
    } else {
      parts.push(
        `${leaderName} leads (${leader.total} assets, furthest at ${this.formatPhase(leader.highestPhase)})`
      );
    }

    // Deepest late-stage: first spoke (excluding leader) with P3 count > 0
    const deepestLateStage = stats.slice(1).find((s) => s.p3 > 0);
    if (deepestLateStage) {
      const name = `<strong>${this.escapeName(deepestLateStage.spoke.name)}</strong>`;
      parts.push(`${name} deepest P3 pipeline (${deepestLateStage.p3})`);
    }

    // Most active: spoke with most has_recent_activity assets (if >= 2)
    const mostActive = [...stats].sort(
      (a, b) => b.recentActivity - a.recentActivity
    )[0];
    if (mostActive && mostActive.recentActivity >= 2 && mostActive !== leader) {
      const name = `<strong>${this.escapeName(mostActive.spoke.name)}</strong>`;
      parts.push(`${name} most active (${mostActive.recentActivity} events)`);
    }

    return parts.join(' | ');
  });

  private formatPhase(phase: RingPhase): string {
    const labels: Record<RingPhase, string> = {
      PRECLIN: 'Preclinical',
      P1: 'Phase 1',
      P2: 'Phase 2',
      P3: 'Phase 3',
      P4: 'Phase 4',
      APPROVED: 'Approved',
      LAUNCHED: 'Launched',
    };
    return labels[phase];
  }

  private escapeName(name: string): string {
    return name
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
