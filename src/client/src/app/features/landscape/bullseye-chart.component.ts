import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import {
  BullseyeData,
  BullseyeAsset,
  PHASE_COLOR,
  RING_DEV_RANK,
  RING_ORDER,
  RingPhase,
} from '../../core/models/landscape.model';
import { phaseShortLabel } from '../../core/models/phase-colors';
import {
  SpokeLabelTransform,
  CX,
  CY,
  INNER_RADIUS,
  OUTER_RADIUS,
  annularBandPath,
  ringLabelHalo,
  spokeAngle,
  spokeLabelTransform,
  jitterAngles,
  polarToCartesian,
  ringRadius,
  sectorAnnularPath,
  sectorWidth,
} from './bullseye-geometry';

interface RingSpec {
  devRank: number;
  phase: RingPhase;
  radius: number;
  isOuter: boolean;
}

interface SpokeLineSpec {
  spokeId: string;
  x2: number;
  y2: number;
}

interface SectorSpec {
  spokeId: string;
  path: string;
  fill: string;
}

interface BandSpec {
  phase: RingPhase;
  path: string;
  fill: string;
}

interface SpokeLabelSpec extends SpokeLabelTransform {
  id: string;
  name: string;
  abbreviation: string;
}

interface DotSpec {
  product: BullseyeAsset;
  x: number;
  y: number;
}

interface RingLabelSpec {
  phase: RingPhase;
  text: string;
  fill: string;
  x: number;
  y: number;
  haloX: number;
  haloY: number;
  haloW: number;
  haloH: number;
}

/** Left edge of the ring label text in the 12 o'clock gutter. */
const RING_LABEL_X = CX + 8;
/** Horizontal padding baked into ringLabelHalo, mirrored to place the halo. */
const RING_LABEL_HALO_PAD_X = 5;
/** Cap height + top padding used to lift the halo above the text baseline. */
const RING_LABEL_HALO_CAP = 13;
const RING_LABEL_HALO_PAD_Y = 3;

const LABEL_SHRINK_THRESHOLD = 12;
const ABBREVIATION_MAX_LENGTH = 14;
const LONG_NAME_THRESHOLD = 14;
const HOVER_RADIUS = 11;
const DEFAULT_RADIUS = 8;
const SELECTED_RADIUS = 12;
const DIMMED_OPACITY = 0.55;

@Component({
  selector: 'app-bullseye-chart',
  standalone: true,
  imports: [],
  templateUrl: './bullseye-chart.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes pulse-ring {
      0% {
        r: 13;
        opacity: 0.5;
      }
      100% {
        r: 22;
        opacity: 0;
      }
    }
    .activity-pulse {
      animation: pulse-ring 2.5s ease-out infinite;
      pointer-events: none;
    }
    .halo-ring,
    .dup-ring {
      pointer-events: none;
    }
  `,
})
export class BullseyeChartComponent {
  readonly data = input.required<BullseyeData | null>();
  readonly selectedAssetId = input<string | null>(null);
  readonly hoveredAssetId = input<string | null>(null);
  readonly highlightedRing = input<RingPhase | null>(null);
  readonly matchedAssetIds = input<Set<string> | null>(null);
  readonly duplicatedAssetIds = input<Set<string>>(new Set());

  readonly productHover = output<string | null>();
  readonly assetClick = output<string>();
  readonly backgroundClick = output<void>();

  /** Internal hover signal for cross-spoke highlighting within this chart instance. */
  protected readonly internalHoveredAssetId = signal<string | null>(null);

  protected readonly isAnyHovered = computed(() => {
    return this.hoveredAssetId() !== null || this.internalHoveredAssetId() !== null;
  });

  /** The effective hovered asset: parent input takes priority, then internal. */
  protected readonly effectiveHoveredAssetId = computed(() => {
    return this.hoveredAssetId() ?? this.internalHoveredAssetId();
  });

  // Expose geometry constants to the template
  protected readonly cx = CX;
  protected readonly cy = CY;
  protected readonly innerRadius = INNER_RADIUS;
  protected readonly outerRadius = OUTER_RADIUS;

  protected readonly spokes = computed(() => this.data()?.spokes ?? []);

  protected readonly totalSpokes = computed(() => this.spokes().length);

  // Number of rings actually drawn. Driven by the data's ring_order, which the
  // server (and the client-grouped fallback) narrow to the space's tracked
  // phases -- 6 when preclinical is hidden, 7 otherwise.
  protected readonly ringCount = computed(() => this.data()?.ring_order?.length ?? RING_ORDER.length);

  protected readonly rings = computed<RingSpec[]>(() => {
    // ring_order is in development order (earliest -> LAUNCHED); the earliest
    // tracked phase is the outer rim. Fall back to the full order if absent.
    const order = (this.data()?.ring_order as RingPhase[] | undefined) ?? [...RING_ORDER];
    const count = order.length;
    const outerDevRank = Math.min(...order.map((phase) => RING_DEV_RANK[phase]));
    return order.map((phase) => {
      const devRank = RING_DEV_RANK[phase];
      return {
        devRank,
        phase,
        radius: ringRadius(devRank, count),
        isOuter: devRank === outerDevRank,
      };
    });
  });

  protected readonly spokeLines = computed<SpokeLineSpec[]>(() => {
    const spokes = this.spokes();
    const total = spokes.length;
    return spokes.map((s, i) => {
      const angle = spokeAngle(i, total);
      const endpoint = polarToCartesian(angle, OUTER_RADIUS);
      return { spokeId: s.id, x2: endpoint.x, y2: endpoint.y };
    });
  });

  protected readonly bands = computed<BandSpec[]>(() => {
    // One annular band per gap between consecutive rings (six normally, five
    // when preclinical is hidden): each fills the area between two consecutive
    // ring radii. Drawn between sectors and rings; uses an additive slate
    // tint at low alpha so it darkens whatever sector tint sits below
    // without obscuring it.
    const ringSpecs = this.rings();
    // sort outer (PRECLIN) -> inner (LAUNCHED) by descending devRank distance
    const sorted = [...ringSpecs].sort((a, b) => b.radius - a.radius);
    const result: BandSpec[] = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const outer = sorted[i];
      const inner = sorted[i + 1];
      result.push({
        phase: outer.phase,
        path: annularBandPath(outer.radius, inner.radius),
        // Alternate between a faint slate darkener and transparent so
        // every other phase band reads slightly heavier.
        fill: i % 2 === 0 ? 'rgba(100, 116, 139, 0.10)' : 'rgba(100, 116, 139, 0)',
      });
    }
    return result;
  });

  protected readonly sectors = computed<SectorSpec[]>(() => {
    const spokes = this.spokes();
    const total = spokes.length;
    // For even spoke counts, alternate two shades. For odd counts we
    // rotate through three shades so we never get two adjacent wedges
    // with the same fill at the wrap-around (which would look like one
    // big wedge instead of two distinct spokes).
    const tints = total % 2 === 0 ? ['#e2e8f0', '#ffffff'] : ['#e2e8f0', '#ffffff', '#f1f5f9'];
    return spokes.map((s, i) => ({
      spokeId: s.id,
      path: sectorAnnularPath(i, total),
      fill: tints[i % tints.length],
    }));
  });

  protected readonly spokeLabels = computed<SpokeLabelSpec[]>(() => {
    const spokes = this.spokes();
    const total = spokes.length;
    const forceShrink = total > LABEL_SHRINK_THRESHOLD;
    return spokes.map((s, i) => {
      const transform = spokeLabelTransform(spokeAngle(i, total));
      const needsAbbreviation = forceShrink || s.name.length > LONG_NAME_THRESHOLD;
      const displayName = needsAbbreviation ? abbreviateSpokeName(s.name) : s.name.toUpperCase();
      return {
        id: s.id,
        name: displayName,
        abbreviation: s.name,
        ...transform,
      };
    });
  });

  protected readonly dots = computed<DotSpec[]>(() => {
    const spokes = this.spokes();
    const total = spokes.length;
    const sectorW = sectorWidth(total);
    const out: DotSpec[] = [];

    spokes.forEach((spoke, spokeIndex) => {
      // Group products by dev rank so we can jitter overlapping dots
      const byRank = new Map<number, BullseyeAsset[]>();
      for (const product of spoke.products) {
        const list = byRank.get(product.highest_phase_rank) ?? [];
        list.push(product);
        byRank.set(product.highest_phase_rank, list);
      }

      const baseAngle = spokeAngle(spokeIndex, total);

      const count = this.ringCount();
      for (const [devRank, products] of byRank) {
        const angles = jitterAngles(baseAngle, sectorW, products.length);
        for (let i = 0; i < products.length; i += 1) {
          const xy = polarToCartesian(angles[i], ringRadius(devRank, count));
          out.push({ product: products[i], x: xy.x, y: xy.y });
        }
      }
    });

    return out;
  });

  // Ring labels live in the 12 o'clock gutter, where spoke-0 dots also land.
  // Each label carries a semi-opaque halo rect drawn behind it so the colored
  // monospace text stays legible over any dot it overlaps. LAUNCHED is omitted
  // (the center disc is the clearer anchor for the innermost position).
  protected readonly ringLabels = computed<RingLabelSpec[]>(() => {
    return this.rings()
      .filter((ring) => ring.phase !== 'LAUNCHED')
      .map((ring) => {
        const text = this.ringLabel(ring.phase);
        const halo = ringLabelHalo(text);
        const baselineY = this.ringLabelY(ring.radius);
        return {
          phase: ring.phase,
          text,
          fill: this.ringLabelFill(ring.phase),
          x: RING_LABEL_X,
          y: baselineY,
          haloX: RING_LABEL_X - RING_LABEL_HALO_PAD_X,
          haloY: baselineY - RING_LABEL_HALO_CAP - RING_LABEL_HALO_PAD_Y,
          haloW: halo.width,
          haloH: halo.height,
        };
      });
  });

  protected readonly ariaLabel = computed(() => {
    const scope = this.data()?.scope;
    const productCount = this.dots().length;
    const spokeCount = this.totalSpokes();
    if (!scope) return 'Competitive landscape bullseye chart';
    return `Competitive landscape bullseye for ${scope.name}. ${productCount} products across ${spokeCount} spokes.`;
  });

  protected readonly productCountSummary = computed(() => {
    const d = this.data();
    if (!d) return '';
    // The chart draws one dot per placement; a multi-indication / multi-spoke
    // asset draws more than once. Counting placements as "assets" is misleading
    // (e.g. 28 dots across 23 distinct assets), so name both when they differ.
    const placements = this.dots().length;
    const distinct = new Set(this.dots().map((dot) => dot.product.id)).size;
    const assetsNoun = distinct === 1 ? 'asset' : 'assets';
    if (placements === distinct) {
      return `${distinct} ${assetsNoun}`;
    }
    return `${placements} placements · ${distinct} ${assetsNoun}`;
  });

  protected dotRadius(dot: DotSpec): number {
    if (this.selectedAssetId() === dot.product.id) return SELECTED_RADIUS;
    if (this.hoveredAssetId() === dot.product.id) return HOVER_RADIUS;
    return DEFAULT_RADIUS;
  }

  protected dotFill(dot: DotSpec): string {
    return PHASE_COLOR[dot.product.highest_phase] ?? '#0d9488';
  }

  protected ringLabelFill(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }

  protected ringLabel(phase: RingPhase): string {
    return phaseShortLabel(phase);
  }

  protected isAssetMatched(assetId: string): boolean {
    const set = this.matchedAssetIds();
    return set === null || set.has(assetId);
  }

  protected dotOpacity(dot: DotSpec): number {
    if (!this.isAssetMatched(dot.product.id)) return 0.15;
    const selected = this.selectedAssetId();
    const highlightRing = this.highlightedRing();
    const hovered = this.effectiveHoveredAssetId();
    if (selected && selected !== dot.product.id) return DIMMED_OPACITY;
    if (highlightRing && dot.product.highest_phase !== highlightRing) return DIMMED_OPACITY;
    // Cross-spoke hover dimming: when any asset is hovered, dim all others to 15%
    if (hovered && hovered !== dot.product.id) return 0.15;
    return 1;
  }

  protected isDuplicate(assetId: string): boolean {
    return this.duplicatedAssetIds().has(assetId);
  }

  protected isHighlighted(assetId: string): boolean {
    return this.effectiveHoveredAssetId() === assetId;
  }

  protected onDotMouseEnter(assetId: string): void {
    this.internalHoveredAssetId.set(assetId);
    this.productHover.emit(assetId);
  }

  protected onDotMouseLeave(): void {
    this.internalHoveredAssetId.set(null);
    this.productHover.emit(null);
  }

  protected dotAriaLabel(dot: DotSpec): string {
    return `${dot.product.name}, ${dot.product.company_name}, highest phase ${dot.product.highest_phase}`;
  }

  protected onDotClick(event: Event, assetId: string): void {
    event.stopPropagation();
    this.assetClick.emit(assetId);
  }

  protected onDotKeydown(event: KeyboardEvent, assetId: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      this.assetClick.emit(assetId);
    }
  }

  protected onHoverStart(assetId: string): void {
    this.productHover.emit(assetId);
  }

  protected onHoverEnd(): void {
    this.productHover.emit(null);
  }

  protected onBackgroundClick(): void {
    this.backgroundClick.emit();
  }

  protected ringLabelY(radius: number): number {
    return CY - radius + 14;
  }

  protected readonly scopeName = computed(() => this.data()?.scope?.name ?? '');
  protected readonly scopeAbbreviation = computed(() => this.data()?.scope?.abbreviation ?? '');
}

function abbreviateSpokeName(name: string): string {
  const firstWord = name.split(/\s+/)[0] ?? name;
  return firstWord.slice(0, ABBREVIATION_MAX_LENGTH).toUpperCase();
}
