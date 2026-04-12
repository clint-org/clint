import { Component, computed, input, output } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';

import {
  BullseyeData,
  BullseyeProduct,
  PHASE_COLOR,
  RingPhase,
} from '../../core/models/landscape.model';
import {
  CompanyLabelTransform,
  CX,
  CY,
  INNER_RADIUS,
  OUTER_RADIUS,
  annularBandPath,
  companyAngle,
  companyLabelTransform,
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

interface SpokeSpec {
  companyId: string;
  x2: number;
  y2: number;
}

interface SectorSpec {
  companyId: string;
  path: string;
  fill: string;
}

interface BandSpec {
  phase: RingPhase;
  path: string;
  fill: string;
}

interface CompanyLabelSpec extends CompanyLabelTransform {
  id: string;
  name: string;
  abbreviation: string;
}

interface DotSpec {
  product: BullseyeProduct;
  x: number;
  y: number;
}

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
  imports: [Tooltip],
  templateUrl: './bullseye-chart.component.html',
})
export class BullseyeChartComponent {
  readonly data = input.required<BullseyeData | null>();
  readonly selectedProductId = input<string | null>(null);
  readonly hoveredProductId = input<string | null>(null);
  readonly highlightedRing = input<RingPhase | null>(null);
  readonly matchedProductIds = input<Set<string> | null>(null);

  readonly productHover = output<string | null>();
  readonly productClick = output<string>();
  readonly backgroundClick = output<void>();

  // Expose geometry constants to the template
  protected readonly cx = CX;
  protected readonly cy = CY;
  protected readonly innerRadius = INNER_RADIUS;
  protected readonly outerRadius = OUTER_RADIUS;

  protected readonly companies = computed(() => this.data()?.companies ?? []);

  protected readonly totalCompanies = computed(() => this.companies().length);

  protected readonly rings = computed<RingSpec[]>(() => {
    const phases: RingPhase[] = ['LAUNCHED', 'APPROVED', 'P4', 'P3', 'P2', 'P1', 'PRECLIN'];
    const devRanks = [6, 5, 4, 3, 2, 1, 0];
    return phases.map((phase, i) => ({
      devRank: devRanks[i],
      phase,
      radius: ringRadius(devRanks[i]),
      isOuter: devRanks[i] === 0,
    }));
  });

  protected readonly spokes = computed<SpokeSpec[]>(() => {
    const companies = this.companies();
    const total = companies.length;
    return companies.map((c, i) => {
      const angle = companyAngle(i, total);
      const endpoint = polarToCartesian(angle, OUTER_RADIUS);
      return { companyId: c.id, x2: endpoint.x, y2: endpoint.y };
    });
  });

  protected readonly bands = computed<BandSpec[]>(() => {
    // Six annular bands: each one fills the area between two consecutive
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
    const companies = this.companies();
    const total = companies.length;
    // For even company counts, alternate two shades. For odd counts we
    // rotate through three shades so we never get two adjacent wedges
    // with the same fill at the wrap-around (which would look like one
    // big wedge instead of two distinct companies).
    const tints = total % 2 === 0 ? ['#e2e8f0', '#ffffff'] : ['#e2e8f0', '#ffffff', '#f1f5f9'];
    return companies.map((c, i) => ({
      companyId: c.id,
      path: sectorAnnularPath(i, total),
      fill: tints[i % tints.length],
    }));
  });

  protected readonly companyLabels = computed<CompanyLabelSpec[]>(() => {
    const companies = this.companies();
    const total = companies.length;
    const forceShrink = total > LABEL_SHRINK_THRESHOLD;
    return companies.map((c, i) => {
      const transform = companyLabelTransform(companyAngle(i, total));
      const needsAbbreviation = forceShrink || c.name.length > LONG_NAME_THRESHOLD;
      const displayName = needsAbbreviation ? abbreviateCompanyName(c.name) : c.name.toUpperCase();
      return {
        id: c.id,
        name: displayName,
        abbreviation: c.name,
        ...transform,
      };
    });
  });

  protected readonly dots = computed<DotSpec[]>(() => {
    const companies = this.companies();
    const total = companies.length;
    const sectorW = sectorWidth(total);
    const out: DotSpec[] = [];

    companies.forEach((company, companyIndex) => {
      // Group products by dev rank so we can jitter overlapping dots
      const byRank = new Map<number, BullseyeProduct[]>();
      for (const product of company.products) {
        const list = byRank.get(product.highest_phase_rank) ?? [];
        list.push(product);
        byRank.set(product.highest_phase_rank, list);
      }

      const baseAngle = companyAngle(companyIndex, total);

      for (const [devRank, products] of byRank) {
        const angles = jitterAngles(baseAngle, sectorW, products.length);
        for (let i = 0; i < products.length; i += 1) {
          const xy = polarToCartesian(angles[i], ringRadius(devRank));
          out.push({ product: products[i], x: xy.x, y: xy.y });
        }
      }
    });

    return out;
  });

  protected readonly ariaLabel = computed(() => {
    const ta = this.data()?.therapeutic_area;
    const productCount = this.dots().length;
    const companyCount = this.totalCompanies();
    if (!ta) return 'Competitive landscape bullseye chart';
    return `Competitive landscape bullseye for ${ta.name}. ${productCount} products across ${companyCount} companies.`;
  });

  protected readonly productCountSummary = computed(() => {
    const productCount = this.dots().length;
    const companyCount = this.totalCompanies();
    const productNoun = productCount === 1 ? 'product' : 'products';
    const companyNoun = companyCount === 1 ? 'company' : 'companies';
    return `${productCount} ${productNoun} across ${companyCount} ${companyNoun}`;
  });

  protected dotRadius(dot: DotSpec): number {
    if (this.selectedProductId() === dot.product.id) return SELECTED_RADIUS;
    if (this.hoveredProductId() === dot.product.id) return HOVER_RADIUS;
    return DEFAULT_RADIUS;
  }

  protected dotFill(dot: DotSpec): string {
    return PHASE_COLOR[dot.product.highest_phase] ?? '#0d9488';
  }

  protected ringLabelFill(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }

  protected isProductMatched(productId: string): boolean {
    const set = this.matchedProductIds();
    return set === null || set.has(productId);
  }

  protected dotOpacity(dot: DotSpec): number {
    if (!this.isProductMatched(dot.product.id)) return 0.15;
    const selected = this.selectedProductId();
    const highlightRing = this.highlightedRing();
    if (selected && selected !== dot.product.id) return DIMMED_OPACITY;
    if (highlightRing && dot.product.highest_phase !== highlightRing) return DIMMED_OPACITY;
    return 1;
  }

  protected dotTooltip(dot: DotSpec): string {
    const generic = dot.product.generic_name ? ` (${dot.product.generic_name})` : '';
    return `${dot.product.name}${generic} — ${dot.product.highest_phase}`;
  }

  protected dotAriaLabel(dot: DotSpec): string {
    return `${dot.product.name}, ${dot.product.company_name}, highest phase ${dot.product.highest_phase}`;
  }

  protected onDotClick(event: Event, productId: string): void {
    event.stopPropagation();
    this.productClick.emit(productId);
  }

  protected onDotKeydown(event: KeyboardEvent, productId: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      this.productClick.emit(productId);
    }
  }

  protected onHoverStart(productId: string): void {
    this.productHover.emit(productId);
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

  protected taName = computed(() => this.data()?.therapeutic_area?.name ?? '');
  protected taAbbreviation = computed(() => this.data()?.therapeutic_area?.abbreviation ?? '');
}

function abbreviateCompanyName(name: string): string {
  const firstWord = name.split(/\s+/)[0] ?? name;
  return firstWord.slice(0, ABBREVIATION_MAX_LENGTH).toUpperCase();
}
