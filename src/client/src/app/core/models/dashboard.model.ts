import { Company } from './company.model';

export interface DashboardData {
  companies: Company[];
}

export interface DashboardFilters {
  companyIds: string[] | null;
  productIds: string[] | null;
  therapeuticAreaIds: string[] | null;
  startYear: number | null;
  endYear: number | null;
  recruitmentStatuses: string[] | null;
  studyTypes: string[] | null;
  phases: string[] | null;
  mechanismOfActionIds: string[] | null;
  routeOfAdministrationIds: string[] | null;
}

export type ZoomLevel = 'yearly' | 'quarterly' | 'monthly' | 'daily';
