import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';

interface RoleColumn {
  key: 'owner' | 'contributor' | 'reader';
  label: string;
  summary: string;
}

interface CapabilityRow {
  group: string;
  capability: string;
  owner: 'yes' | 'no';
  contributor: 'yes' | 'no';
  reader: 'yes' | 'no';
}

@Component({
  selector: 'app-roles-help',
  standalone: true,
  imports: [RouterLink, ManagePageShellComponent],
  template: `
    <app-manage-page-shell>
      <div class="max-w-3xl">
        <header class="mb-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Help
          </p>
          <h1 class="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            Roles and permissions
          </h1>
          <p class="mt-1 max-w-xl text-sm text-slate-500">
            What each role can do inside a space. Use this when deciding what role
            to give a new analyst or a client team member.
          </p>
        </header>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            The three space roles
          </h2>
          <div class="border border-slate-200 bg-white">
            @for (role of roleColumns; track role.key) {
              <div class="grid grid-cols-[8rem_1fr] gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0">
                <div class="text-sm font-semibold text-slate-900">{{ role.label }}</div>
                <div class="text-sm text-slate-600">{{ role.summary }}</div>
              </div>
            }
          </div>
        </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            What each role can do
          </h2>
          <div class="overflow-x-auto border border-slate-200 bg-white">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-slate-200 bg-slate-50">
                  <th
                    class="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                  >
                    Capability
                  </th>
                  <th
                    class="w-24 px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                  >
                    Owner
                  </th>
                  <th
                    class="w-24 px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                  >
                    Contributor
                  </th>
                  <th
                    class="w-24 px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                  >
                    Reader
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (group of groupedRows(); track group.title) {
                  <tr class="border-t border-slate-200 bg-slate-50/40">
                    <td
                      class="px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                      colspan="4"
                    >
                      {{ group.title }}
                    </td>
                  </tr>
                  @for (row of group.rows; track row.capability) {
                    <tr class="border-t border-slate-100">
                      <td class="px-5 py-3 text-slate-700">{{ row.capability }}</td>
                      <td class="px-3 py-3 text-center">
                        <span [class]="cellClass(row.owner)">{{ cellSymbol(row.owner) }}</span>
                      </td>
                      <td class="px-3 py-3 text-center">
                        <span [class]="cellClass(row.contributor)">{{
                          cellSymbol(row.contributor)
                        }}</span>
                      </td>
                      <td class="px-3 py-3 text-center">
                        <span [class]="cellClass(row.reader)">{{ cellSymbol(row.reader) }}</span>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Common questions
          </h2>
          <div class="space-y-5">
            @for (entry of faq; track entry.q) {
              <div>
                <p class="text-sm font-semibold text-slate-900">{{ entry.q }}</p>
                <p class="mt-1 text-sm text-slate-600">{{ entry.a }}</p>
              </div>
            }
          </div>
        </section>

        <p class="mt-8 text-xs text-slate-400">
          <a [routerLink]="backLink()" class="text-brand-700 hover:underline"
            >Back to space members</a
          >
        </p>
      </div>
    </app-manage-page-shell>
  `,
})
export class RolesHelpComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly roleColumns: RoleColumn[] = [
    {
      key: 'owner',
      label: 'Owner',
      summary:
        'Full control of the space. Edits all data, manages members, changes settings, can delete the space.',
    },
    {
      key: 'contributor',
      label: 'Contributor',
      summary:
        'Edits the data inside the space. Cannot manage members, change space settings, or delete.',
    },
    {
      key: 'reader',
      label: 'Reader',
      summary: 'Sees everything in the space. Cannot edit anything.',
    },
  ];

  protected readonly capabilityRows: CapabilityRow[] = [
    {
      group: 'Engagement data',
      capability: 'View companies, products, trials, catalysts, events',
      owner: 'yes',
      contributor: 'yes',
      reader: 'yes',
    },
    {
      group: 'Engagement data',
      capability: 'Add or edit catalysts, markers, trials, trial notes',
      owner: 'yes',
      contributor: 'yes',
      reader: 'no',
    },
    {
      group: 'Engagement data',
      capability: 'Add or edit events, sources, threads, links',
      owner: 'yes',
      contributor: 'yes',
      reader: 'no',
    },
    {
      group: 'Engagement data',
      capability: 'Add or edit therapy areas, mechanisms, routes of administration',
      owner: 'yes',
      contributor: 'yes',
      reader: 'no',
    },
    {
      group: 'Engagement structure',
      capability: 'Invite people to the space',
      owner: 'yes',
      contributor: 'no',
      reader: 'no',
    },
    {
      group: 'Engagement structure',
      capability: 'Change someone else’s role in the space',
      owner: 'yes',
      contributor: 'no',
      reader: 'no',
    },
    {
      group: 'Engagement structure',
      capability: 'Remove someone from the space',
      owner: 'yes',
      contributor: 'no',
      reader: 'no',
    },
    {
      group: 'Engagement structure',
      capability: 'Rename the space, edit description',
      owner: 'yes',
      contributor: 'no',
      reader: 'no',
    },
    {
      group: 'Engagement structure',
      capability: 'Delete the space',
      owner: 'yes',
      contributor: 'no',
      reader: 'no',
    },
    {
      group: 'Read-only views',
      capability: 'Timeline, bullseye landscape, positioning views',
      owner: 'yes',
      contributor: 'yes',
      reader: 'yes',
    },
    {
      group: 'Read-only views',
      capability: 'Export the dashboard as PowerPoint',
      owner: 'yes',
      contributor: 'yes',
      reader: 'yes',
    },
  ];

  protected readonly faq = [
    {
      q: 'When should I make someone a Contributor instead of an Owner?',
      a: 'Make people Contributors by default. Owner status is for the people who decide who else gets in and what the space contains. Most analysts working an engagement should be Contributors. Promote to Owner only when someone needs to manage the space itself.',
    },
    {
      q: 'When is Reader the right role?',
      a: 'When the person consumes the analysis but should not change it. Typical cases: a client stakeholder who reviews findings, an executive who reads catalysts, an auditor.',
    },
    {
      q: 'What happens when I add an agency colleague to a space?',
      a: 'They get the role you assign in this space, the same as anyone else. Agency membership outside the space does not grant any data access; the firewall between engagements is enforced per space.',
    },
    {
      q: 'Can a Reader see who else is in the space?',
      a: 'Yes. The members list is visible to everyone in the space. Only Owners can change it.',
    },
    {
      q: 'A tenant owner who is not in this space, what can they see?',
      a: 'They see the space exists in the tenant’s spaces list, and they can manage tenant-level settings (members, branding for direct customers). They cannot see any data inside the space until they are explicitly added as Owner, Contributor, or Reader.',
    },
  ];

  protected groupedRows(): { title: string; rows: CapabilityRow[] }[] {
    const groups = new Map<string, CapabilityRow[]>();
    for (const row of this.capabilityRows) {
      const list = groups.get(row.group) ?? [];
      list.push(row);
      groups.set(row.group, list);
    }
    return Array.from(groups.entries()).map(([title, rows]) => ({ title, rows }));
  }

  protected cellSymbol(value: 'yes' | 'no'): string {
    return value === 'yes' ? 'Yes' : 'No';
  }

  protected cellClass(value: 'yes' | 'no'): string {
    return value === 'yes'
      ? 'inline-block min-w-[2.5rem] text-xs font-semibold text-brand-700'
      : 'inline-block min-w-[2.5rem] text-xs font-semibold text-slate-300';
  }

  protected backLink(): string[] {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    return tenantId ? ['/t', tenantId, 'spaces'] : ['/'];
  }
}
