import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TherapeuticArea } from '../../../core/models/trial.model';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';

@Component({
  selector: 'app-therapeutic-area-form',
  standalone: true,
  imports: [FormsModule],
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
        result = await this.areaService.create(payload);
      }
      this.saved.emit(result);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save therapeutic area');
    } finally {
      this.submitting.set(false);
    }
  }
}
