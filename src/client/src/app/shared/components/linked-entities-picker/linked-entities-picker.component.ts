import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';

import {
  IntelligenceLinkEntityType,
  PrimaryIntelligenceLink,
  RELATIONSHIP_OPTIONS,
} from '../../../core/models/primary-intelligence.model';
import { SupabaseService } from '../../../core/services/supabase.service';

interface EntityOption {
  entity_type: IntelligenceLinkEntityType;
  entity_id: string;
  label: string;
  sub_label: string;
}

/**
 * Chip picker rendered at the bottom of the authoring drawer. Lets the
 * author attach trials, markers, companies, and products with a
 * relationship type. Loads options from the current space on demand.
 */
@Component({
  selector: 'app-linked-entities-picker',
  standalone: true,
  imports: [FormsModule, ButtonModule, SelectModule, InputTextModule],
  template: `
    <div class="space-y-3">
      <ul class="space-y-2" aria-label="Linked entities">
        @for (link of links(); track link.entity_type + link.entity_id) {
          <li
            class="flex flex-wrap items-center gap-2 rounded-sm border border-slate-200 bg-slate-50/50 px-2.5 py-2"
          >
            <span
              class="rounded-sm border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500"
            >
              {{ link.entity_type }}
            </span>
            <span class="min-w-0 flex-1 truncate text-sm text-slate-800">
              {{ entityLabel(link) }}
            </span>
            <p-select
              [options]="relationshipOptions"
              [ngModel]="link.relationship_type"
              (ngModelChange)="updateRelationship($index, $event)"
              [editable]="true"
              placeholder="Relationship"
              styleClass="w-44 text-xs"
              appendTo="body"
            />
            <input
              pInputText
              type="text"
              [ngModel]="link.gloss ?? ''"
              (ngModelChange)="updateGloss($index, $event)"
              placeholder="Gloss (optional)"
              class="!h-8 w-48 text-xs"
            />
            <p-button
              icon="fa-solid fa-xmark"
              [text]="true"
              size="small"
              severity="secondary"
              ariaLabel="Remove link"
              (onClick)="removeLink($index)"
            />
          </li>
        } @empty {
          <li class="text-xs text-slate-400">No linked entities yet.</li>
        }
      </ul>

      <div class="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <p-select
          [options]="entityTypeOptions"
          [ngModel]="addEntityType()"
          (ngModelChange)="addEntityType.set($event); refreshOptions()"
          placeholder="Type"
          styleClass="w-32"
        />
        <p-select
          [options]="filteredEntityOptions()"
          [ngModel]="addEntityId()"
          (ngModelChange)="addEntityId.set($event)"
          [filter]="true"
          filterBy="label,sub_label"
          placeholder="Search..."
          styleClass="w-72"
          appendTo="body"
          [virtualScroll]="filteredEntityOptions().length > 20"
          [virtualScrollItemSize]="38"
        />
        <p-select
          [options]="relationshipOptions"
          [ngModel]="addRelationship()"
          (ngModelChange)="addRelationship.set($event)"
          [editable]="true"
          placeholder="Relationship"
          styleClass="w-44"
          appendTo="body"
        />
        <p-button
          label="Add link"
          icon="fa-solid fa-plus"
          size="small"
          [text]="true"
          [disabled]="!canAdd()"
          (onClick)="addLink()"
        />
      </div>
    </div>
  `,
})
export class LinkedEntitiesPickerComponent implements OnInit {
  private supabase = inject(SupabaseService);

  readonly spaceId = input.required<string>();
  readonly value = input<PrimaryIntelligenceLink[]>([]);
  readonly valueChange = output<PrimaryIntelligenceLink[]>();

  protected readonly links = signal<PrimaryIntelligenceLink[]>([]);
  protected readonly addEntityType = signal<IntelligenceLinkEntityType | null>(null);
  protected readonly addEntityId = signal<string | null>(null);
  protected readonly addRelationship = signal<string>('');

  protected readonly entityOptions = signal<EntityOption[]>([]);

  protected readonly entityTypeOptions = [
    { label: 'Trial', value: 'trial' },
    { label: 'Marker', value: 'marker' },
    { label: 'Company', value: 'company' },
    { label: 'Product', value: 'product' },
  ];

  protected readonly relationshipOptions = RELATIONSHIP_OPTIONS.map((r) => ({ label: r, value: r }));

  protected readonly filteredEntityOptions = computed(() => {
    const t = this.addEntityType();
    if (!t) return [];
    const taken = new Set(
      this.links().filter((l) => l.entity_type === t).map((l) => l.entity_id)
    );
    return this.entityOptions()
      .filter((o) => o.entity_type === t && !taken.has(o.entity_id))
      .map((o) => ({ label: o.label, sub_label: o.sub_label, value: o.entity_id }));
  });

  protected readonly canAdd = computed(
    () => !!this.addEntityType() && !!this.addEntityId() && !!this.addRelationship().trim()
  );

  ngOnInit(): void {
    this.links.set([...(this.value() ?? [])]);
    void this.loadOptions();
  }

  protected entityLabel(link: PrimaryIntelligenceLink): string {
    const match = this.entityOptions().find(
      (o) => o.entity_type === link.entity_type && o.entity_id === link.entity_id
    );
    return match?.label ?? `${link.entity_type} ${link.entity_id.slice(0, 8)}`;
  }

  protected refreshOptions(): void {
    this.addEntityId.set(null);
  }

  protected updateRelationship(index: number, next: string): void {
    const arr = [...this.links()];
    arr[index] = { ...arr[index], relationship_type: next ?? '' };
    this.commit(arr);
  }

  protected updateGloss(index: number, next: string): void {
    const arr = [...this.links()];
    arr[index] = { ...arr[index], gloss: next?.length ? next : null };
    this.commit(arr);
  }

  protected removeLink(index: number): void {
    const arr = [...this.links()];
    arr.splice(index, 1);
    this.commit(arr);
  }

  protected addLink(): void {
    if (!this.canAdd()) return;
    const arr = [...this.links()];
    arr.push({
      entity_type: this.addEntityType()!,
      entity_id: this.addEntityId()!,
      relationship_type: this.addRelationship().trim(),
      gloss: null,
      display_order: arr.length,
    });
    this.commit(arr);
    this.addEntityId.set(null);
    this.addRelationship.set('');
  }

  private commit(next: PrimaryIntelligenceLink[]): void {
    const renumbered = next.map((l, i) => ({ ...l, display_order: i }));
    this.links.set(renumbered);
    this.valueChange.emit(renumbered);
  }

  private async loadOptions(): Promise<void> {
    const sid = this.spaceId();
    const client = this.supabase.client;

    const [trials, markers, companies, products] = await Promise.all([
      client.from('trials').select('id, name, identifier').eq('space_id', sid).order('name'),
      client.from('markers').select('id, title, event_date').eq('space_id', sid).order('event_date', { ascending: false }).limit(500),
      client.from('companies').select('id, name').eq('space_id', sid).order('name'),
      client.from('products').select('id, name, company_id, companies(name)').eq('space_id', sid).order('name'),
    ]);

    const opts: EntityOption[] = [];
    for (const t of (trials.data ?? []) as { id: string; name: string; identifier: string | null }[]) {
      opts.push({
        entity_type: 'trial',
        entity_id: t.id,
        label: t.name,
        sub_label: t.identifier ?? '',
      });
    }
    for (const m of (markers.data ?? []) as { id: string; title: string; event_date: string }[]) {
      opts.push({
        entity_type: 'marker',
        entity_id: m.id,
        label: m.title,
        sub_label: m.event_date,
      });
    }
    for (const c of (companies.data ?? []) as { id: string; name: string }[]) {
      opts.push({ entity_type: 'company', entity_id: c.id, label: c.name, sub_label: '' });
    }
    for (const p of (products.data ?? []) as {
      id: string;
      name: string;
      companies: { name: string } | { name: string }[] | null;
    }[]) {
      const c = Array.isArray(p.companies) ? p.companies[0] : p.companies;
      opts.push({
        entity_type: 'product',
        entity_id: p.id,
        label: p.name,
        sub_label: c?.name ?? '',
      });
    }

    this.entityOptions.set(opts);
  }
}
