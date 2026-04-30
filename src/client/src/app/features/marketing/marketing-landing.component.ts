import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-marketing-landing',
  standalone: true,
  imports: [ButtonModule, InputTextModule, RouterLink],
  template: `
    <div class="min-h-screen bg-slate-50">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div class="text-sm font-semibold tracking-[0.22em] text-slate-900">CLINT</div>
          <a routerLink="/login" class="text-sm text-slate-600 hover:text-slate-900">Sign in</a>
        </div>
      </header>

      <main>
        <!-- Hero -->
        <section class="mx-auto max-w-6xl px-6 py-24">
          <p class="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">
            Competitive intelligence for pharma
          </p>
          <h1 class="mt-5 max-w-4xl text-4xl font-semibold leading-tight tracking-tight text-slate-900 md:text-5xl">
            The working surface and deliverable layer for pharma CI.
          </h1>
          <p class="mt-6 max-w-2xl text-lg text-slate-600">
            Clint sits on top of the data your firm already consumes and produces. It's where the CI work lives,
            and where clients see it in real time, all the time.
          </p>
        </section>

        <!-- What Clint is -->
        <section class="border-t border-slate-200 bg-white">
          <div class="mx-auto max-w-6xl px-6 py-20">
            <h2 class="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              What Clint is.
            </h2>
            <div class="mt-12 grid gap-px bg-slate-200 md:grid-cols-2">
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Live dashboard</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">Always current</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Trial data refreshes from ClinicalTrials.gov directly. New analyst-curated events show up in the
                  dashboard the moment they're saved, and the client sees them at the same time. The competitive
                  picture reflects the latest event, not the last quarterly briefing.
                </p>
              </div>
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Your analysis</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">Primary intelligence, published live</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Your analysts publish primary analysis and intelligence directly into the platform. As notes are
                  written, the client sees them in real time. With assembly already handled by Clint, analysts spend
                  their time on interpretation and strategic reads, not formatting.
                </p>
              </div>
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Whitelabel</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">A branded site per client</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Each client gets a site branded as your firm, with engagement spaces themed inside it. Agency,
                  client, and engagement-level branding are all supported.
                </p>
              </div>
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Data model</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">Built around pharma</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Companies, products, trials, catalysts, and events are core entities, with a source on every record.
                  Dashboard, briefings, exports, and AI all read from the same data. Nothing gets retyped, nothing
                  falls out of sync.
                </p>
              </div>
            </div>
          </div>
        </section>

        <!-- What changes for your firm -->
        <section class="border-t border-slate-200">
          <div class="mx-auto max-w-6xl px-6 py-20">
            <h2 class="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              What changes for your firm.
            </h2>
            <ul class="mt-10 max-w-4xl">
              <li class="border-t border-slate-200 py-5 pl-6 relative text-sm leading-relaxed text-slate-700">
                <span class="absolute left-0 top-7 h-px w-3 bg-brand-600"></span>
                <strong class="font-semibold text-slate-900">Faster kickoff.</strong>
                The competitive baseline for the target therapeutic area is already in the platform when the
                engagement starts. Analysts begin from a working picture and add your firm's curation and framing on
                top, instead of assembling from scratch.
              </li>
              <li class="border-t border-slate-200 py-5 pl-6 relative text-sm leading-relaxed text-slate-700">
                <span class="absolute left-0 top-7 h-px w-3 bg-brand-600"></span>
                <strong class="font-semibold text-slate-900">Continuous presence.</strong>
                New events show up in the branded site as they happen, with your primary analysis published
                alongside them. The client sees a live, annotated view all quarter, not just on delivery day.
              </li>
              <li class="border-t border-slate-200 py-5 pl-6 relative text-sm leading-relaxed text-slate-700">
                <span class="absolute left-0 top-7 h-px w-3 bg-brand-600"></span>
                <strong class="font-semibold text-slate-900">The briefing focuses on strategy.</strong>
                Data review happens in the platform throughout the quarter, so the meeting opens at recommendations
                and decisions instead of slide narration.
              </li>
              <li class="border-t border-slate-200 py-5 pl-6 relative text-sm leading-relaxed text-slate-700">
                <span class="absolute left-0 top-7 h-px w-3 bg-brand-600"></span>
                <strong class="font-semibold text-slate-900">Stickier renewals.</strong>
                A site that holds the client's annotations, watchlists, and past analysis has real switching cost.
                That's the difference between renewing the relationship and re-pitching it every year.
              </li>
              <li class="border-t border-slate-200 py-5 pl-6 relative text-sm leading-relaxed text-slate-700">
                <span class="absolute left-0 top-7 h-px w-3 bg-brand-600"></span>
                <strong class="font-semibold text-slate-900">No engineering investment.</strong>
                Clint's team runs the ingest pipelines, source updates, infrastructure, and security. You use the
                platform; we run it.
              </li>
            </ul>
          </div>
        </section>

        <!-- A pitch tool for BD -->
        <section class="border-t border-slate-200 bg-white">
          <div class="mx-auto max-w-6xl px-6 py-20">
            <h2 class="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              A pitch tool for BD.
            </h2>
            <p class="mt-3 max-w-2xl text-base text-slate-600">
              The platform isn't only for live engagements. Use it to win them.
            </p>
            <div class="mt-12 grid gap-px bg-slate-200 md:grid-cols-2">
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Start with a working landscape</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">No blank-page assembly before a pitch</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Pre-load competitors, products, trials, and recent events for the prospect's therapeutic area
                  before the meeting. The pitch starts from a working competitive picture, with your firm's data
                  already in place.
                </p>
              </div>
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Layer your intelligence on it</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">Show the kind of read you deliver</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Add primary analysis, framing, and selected catalysts to show what your firm would put in front of
                  them as the consultant. The prospect sees your analytical voice, not a generic dashboard.
                </p>
              </div>
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Demo it live, in your brand</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">The pitch is the product</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Prospects see a working branded site, not a static deck. They get a sneak peek of exactly what
                  they'd use as a client.
                </p>
              </div>
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Data carries forward when they sign</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">The pitch becomes the kickoff baseline</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Whatever was built for the pitch becomes the starting point for the engagement. No re-assembly
                  between BD and delivery.
                </p>
              </div>
            </div>
          </div>
        </section>

        <!-- Three ways to put AI on top -->
        <section class="border-t border-slate-200">
          <div class="mx-auto max-w-6xl px-6 py-20">
            <h2 class="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              Three ways to put AI on top of Clint's data.
            </h2>
            <p class="mt-3 max-w-2xl text-base text-slate-600">
              Clint's data is already structured and cited, which is what AI needs to give reliable answers. Three
              ways to use it are on the roadmap.
            </p>
            <div class="mt-12 grid gap-px bg-slate-200 md:grid-cols-3">
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">For your data team</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">Pull Clint data into your own systems</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Your data team can connect Clint to whatever they already use. Internal tools, AI workflows, data
                  warehouses. The data flows out programmatically, with sources attached.
                </p>
              </div>
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">For analysts using AI assistants</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">Use Clint from inside Claude or Copilot</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Ask Claude or Copilot a question about competitive data, and it answers from Clint with citations.
                  Analysts who already use AI assistants get Clint's data inside their existing workflow, no separate
                  tool to learn.
                </p>
              </div>
              <div class="bg-white p-7">
                <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Inside the platform</p>
                <h3 class="mt-3 text-base font-semibold text-slate-900">AI built into Clint itself</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-600">
                  Generate briefs, run scenario analysis, ask questions, all inside Clint. No need to send client
                  data to outside AI tools.
                </p>
              </div>
            </div>
          </div>
        </section>

        <!-- Find your workspace -->
        <section class="border-t border-slate-200 bg-white">
          <div class="mx-auto max-w-3xl px-6 py-20">
            <h2 class="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              Find your workspace.
            </h2>
            <p class="mt-3 text-base text-slate-600">
              If your firm is already on Clint, sign in to your workspace.
            </p>
            <form class="mt-8 flex gap-2" (submit)="goToWorkspace($event)">
              <div class="flex flex-1 items-stretch border border-slate-300 bg-white">
                <input
                  pInputText
                  type="text"
                  [value]="subdomain()"
                  (input)="onInput($event)"
                  placeholder="your-workspace"
                  class="flex-1 border-0 bg-transparent px-3 py-2 text-sm focus:outline-none"
                  aria-label="Workspace subdomain"
                />
                <span class="border-l border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  .{{ apexDisplay }}
                </span>
              </div>
              <p-button label="Go" [disabled]="!subdomain()" type="submit" />
            </form>
            @if (errorMessage()) {
              <p class="mt-3 text-xs text-red-700" role="alert">{{ errorMessage() }}</p>
            }
            <p class="mt-12 text-xs text-slate-500">
              Are you a consulting partner?
              <a routerLink="/login" class="underline hover:text-slate-700">Sign in to your agency portal.</a>
            </p>
          </div>
        </section>

        <footer class="border-t border-slate-200 bg-slate-50">
          <div class="mx-auto max-w-6xl px-6 py-8 text-xs text-slate-500">
            Clint &mdash; Competitive intelligence for pharma.
          </div>
        </footer>
      </main>
    </div>
  `,
})
export class MarketingLandingComponent {
  private readonly router = inject(Router);

  readonly subdomain = signal<string>('');
  readonly errorMessage = signal<string | null>(null);

  protected readonly apexDisplay = environment.apexDomain || 'yourproduct.com';

  onInput(e: Event) {
    const v = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    this.subdomain.set(v);
    this.errorMessage.set(null);
  }

  goToWorkspace(e: Event) {
    e.preventDefault();
    const sub = this.subdomain().trim();
    if (!sub || !/^[a-z][a-z0-9-]{1,62}$/.test(sub)) {
      this.errorMessage.set(
        'Subdomain must be lowercase letters, numbers, or hyphens, and start with a letter.'
      );
      return;
    }
    if (environment.apexDomain) {
      const url = `${window.location.protocol}//${sub}.${environment.apexDomain}/login`;
      window.location.href = url;
    } else {
      this.router.navigate(['/login'], { queryParams: { workspace: sub } });
    }
  }
}
