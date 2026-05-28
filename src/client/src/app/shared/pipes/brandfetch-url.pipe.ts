import { Pipe, PipeTransform } from '@angular/core';
import { environment } from '../../../environments/environment';

@Pipe({ name: 'brandfetchUrl' })
export class BrandfetchUrlPipe implements PipeTransform {
  transform(url: string | null | undefined): string | null {
    if (!url) return null;
    if (!url.includes('cdn.brandfetch.io')) return url;
    if (url.includes('?c=')) return url;
    if (!environment.brandfetchClientId) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}c=${environment.brandfetchClientId}`;
  }
}
