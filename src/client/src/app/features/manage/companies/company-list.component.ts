import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Company } from '../../../core/models/company.model';
import { CompanyService } from '../../../core/services/company.service';
import { CompanyFormComponent } from './company-form.component';

@Component({
  selector: 'app-company-list',
  standalone: true,
  imports: [TableModule, ButtonModule, Dialog, MessageModule, CompanyFormComponent],
  templateUrl: './company-list.component.html',
})
export class CompanyListComponent implements OnInit {
  companies = signal<Company[]>([]);
  loading = signal(false);
  modalOpen = signal(false);
  editingCompany = signal<Company | null>(null);
  deleteError = signal<string | null>(null);

  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);
  spaceId = '';

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    await this.loadCompanies();
  }

  openCreateModal(): void {
    this.editingCompany.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(company: Company): void {
    this.editingCompany.set(company);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingCompany.set(null);
  }

  async onSaved(): Promise<void> {
    this.closeModal();
    await this.loadCompanies();
  }

  async confirmDelete(company: Company): Promise<void> {
    const confirmed = window.confirm(`Delete "${company.name}"? This action cannot be undone.`);
    if (!confirmed) return;

    this.deleteError.set(null);
    try {
      await this.companyService.delete(company.id);
      await this.loadCompanies();
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete company. It may have associated products.'
      );
    }
  }

  private async loadCompanies(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.companyService.list(this.spaceId);
      this.companies.set(data);
    } catch {
      // Silently handle - empty list shown
    } finally {
      this.loading.set(false);
    }
  }
}
