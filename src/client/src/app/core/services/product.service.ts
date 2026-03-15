import { inject, Injectable } from '@angular/core';

import { Product } from '../models/product.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private supabase = inject(SupabaseService);

  async list(companyId?: string): Promise<Product[]> {
    let query = this.supabase.client
      .from('products')
      .select('*')
      .order('display_order');

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data as Product[];
  }

  async getById(id: string): Promise<Product> {
    const { data, error } = await this.supabase.client
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as Product;
  }

  async create(product: Partial<Product>): Promise<Product> {
    const { data, error } = await this.supabase.client
      .from('products')
      .insert(product)
      .select()
      .single();

    if (error) throw error;
    return data as Product;
  }

  async update(id: string, changes: Partial<Product>): Promise<Product> {
    const { data, error } = await this.supabase.client
      .from('products')
      .update(changes)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Product;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('products')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}
