import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { TherapeuticArea } from '../../../core/models/trial.model';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';

@Component({
  selector: 'app-therapeutic-area-form',
  standalone: true,
  imports: [FormsModule, InputText, ButtonModule, MessageModule],
  templateUrl: './therapeutic-area-form.component.html',
})
export class TherapeuticAreaFormComponent implements OnInit {
  area = input<TherapeuticArea | null>(null);

  saved = output<TherapeuticArea>();
  cancelled = output<void>();

  name = signal('');
  abbreviation = signal('');
  submitting = signal(false);
  error = signal<string | null>(null);
  nameBlurred = signal(false);

  private areaService = inject(TherapeuticAreaService);
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    const a = this.area();
    if (a) {
      this.name.set(a.name);
      this.abbreviation.set(a.abbreviation ?? '');
    }
  }

  get isEdit(): boolean {
    return this.area() !== null;
  }

  get nameInvalid(): boolean {
    return this.nameBlurred() && this.name().trim().length === 0;
  }

  async onSubmit(): Promise<void> {
    this.nameBlurred.set(true);
    if (this.name().trim().length === 0) return;

    this.submitting.set(true);
    this.error.set(null);

    try {
      const payload: Partial<TherapeuticArea> = {
        name: this.name().trim(),
        abbreviation: this.abbreviation().trim() || null,
      };

      let result: TherapeuticArea;
      const existing = this.area();
      if (existing) {
        result = await this.areaService.update(existing.id, payload);
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        result = await this.areaService.create(spaceId, payload);
      }
      this.saved.emit(result);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save therapeutic area');
    } finally {
      this.submitting.set(false);
    }
  }
}
