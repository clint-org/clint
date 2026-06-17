import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A static, data-free render of the timeline instrument for the marketing
 * landing. It is intentionally a hand-built SVG (no live data, no network,
 * no CLS risk) that conveys the shape of the product: company/asset rows,
 * phase bars in the slate -> cyan -> teal -> violet progression, foreground
 * markers, and a today line. Decorative only -- aria-hidden.
 */
@Component({
  selector: 'app-marketing-timeline-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div
        class="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2"
      >
        <span class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Pipeline timeline
        </span>
        <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
          GLP-1 / obesity
        </span>
      </div>
      <svg
        viewBox="0 0 520 320"
        class="h-auto w-full"
        role="img"
        aria-label="Illustrative competitive pipeline timeline"
      >
        <!-- year gridlines -->
        @for (x of gridX; track x) {
          <line [attr.x1]="x" y1="40" [attr.x2]="x" y2="300" stroke="#f1f5f9" stroke-width="1" />
        }
        <!-- year axis labels -->
        @for (yr of years; track yr.label) {
          <text
            [attr.x]="yr.x"
            y="28"
            text-anchor="middle"
            class="fill-slate-400"
            font-family="ui-monospace, monospace"
            font-size="10"
            letter-spacing="1"
          >
            {{ yr.label }}
          </text>
        }

        <!-- rows -->
        @for (row of rows; track row.label) {
          <text
            x="12"
            [attr.y]="row.y + 4"
            class="fill-slate-500"
            font-family="ui-monospace, monospace"
            font-size="9"
            letter-spacing="0.5"
          >
            {{ row.label }}
          </text>
          @for (bar of row.bars; track bar.x) {
            <rect
              [attr.x]="bar.x"
              [attr.y]="row.y - 5"
              [attr.width]="bar.w"
              height="10"
              rx="2"
              [attr.fill]="bar.color"
              opacity="0.9"
            />
          }
          @for (m of row.markers; track m.x) {
            @if (m.shape === 'diamond') {
              <rect
                [attr.x]="m.x - 4"
                [attr.y]="row.y - 4"
                width="8"
                height="8"
                rx="1"
                [attr.fill]="m.color"
                [attr.transform]="'rotate(45 ' + m.x + ' ' + row.y + ')'"
              />
            } @else {
              <circle [attr.cx]="m.x" [attr.cy]="row.y" r="4.5" [attr.fill]="m.color" />
            }
          }
        }

        <!-- today line -->
        <line
          [attr.x1]="todayX"
          y1="36"
          [attr.x2]="todayX"
          y2="304"
          stroke="var(--p-primary-500, #14b8a6)"
          stroke-width="1.5"
          stroke-dasharray="3 3"
        />
        <text
          [attr.x]="todayX"
          y="316"
          text-anchor="middle"
          class="fill-brand-700"
          font-family="ui-monospace, monospace"
          font-size="9"
          letter-spacing="1"
        >
          TODAY
        </text>
      </svg>
    </div>
  `,
})
export class MarketingTimelinePreviewComponent {
  // Phase palette (data colors, fixed -- never brand-tinted).
  private readonly slate = '#94a3b8';
  private readonly cyan = '#67e8f9';
  private readonly teal = '#2dd4bf';
  private readonly violet = '#a78bfa';
  // Marker palette.
  private readonly green = '#16a34a';
  private readonly orange = '#ea580c';
  private readonly blue = '#2563eb';

  protected readonly gridX = [110, 200, 290, 380, 470];
  protected readonly years = [
    { label: '2024', x: 155 },
    { label: '2025', x: 245 },
    { label: '2026', x: 335 },
    { label: '2027', x: 425 },
  ];
  protected readonly todayX = 312;

  protected readonly rows = [
    {
      label: 'LILLY',
      y: 70,
      bars: [
        { x: 110, w: 90, color: this.cyan },
        { x: 200, w: 150, color: this.teal },
      ],
      markers: [
        { x: 250, color: this.green, shape: 'circle' },
        { x: 350, color: this.orange, shape: 'diamond' },
      ],
    },
    {
      label: 'NOVO',
      y: 118,
      bars: [
        { x: 140, w: 110, color: this.cyan },
        { x: 250, w: 120, color: this.teal },
      ],
      markers: [
        { x: 250, color: this.green, shape: 'circle' },
        { x: 370, color: this.blue, shape: 'circle' },
      ],
    },
    {
      label: 'PFIZER',
      y: 166,
      bars: [{ x: 110, w: 120, color: this.slate }],
      markers: [{ x: 230, color: this.green, shape: 'circle' }],
    },
    {
      label: 'AMGEN',
      y: 214,
      bars: [
        { x: 170, w: 130, color: this.cyan },
        { x: 300, w: 90, color: this.teal },
      ],
      markers: [{ x: 300, color: this.green, shape: 'circle' }],
    },
    {
      label: 'VIKING',
      y: 262,
      bars: [
        { x: 200, w: 120, color: this.slate },
        { x: 320, w: 130, color: this.violet },
      ],
      markers: [{ x: 450, color: this.blue, shape: 'circle' }],
    },
  ];
}
