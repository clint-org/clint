import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-landscape-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="landscape-shell">
      <nav class="landscape-sidebar" aria-label="Landscape dimensions">
        <a
          routerLink="by-therapy-area"
          routerLinkActive="active"
          class="landscape-sidebar-item"
          aria-label="View by therapy area"
        >
          <i class="pi pi-th-large"></i>
          <span>Therapy Area</span>
        </a>
        <a
          routerLink="by-company"
          routerLinkActive="active"
          class="landscape-sidebar-item"
          aria-label="View by company"
        >
          <i class="pi pi-building"></i>
          <span>Company</span>
        </a>
        <a
          routerLink="by-moa"
          routerLinkActive="active"
          class="landscape-sidebar-item"
          aria-label="View by mechanism of action"
        >
          <i class="pi pi-sitemap"></i>
          <span>Mechanism of Action</span>
        </a>
        <a
          routerLink="by-roa"
          routerLinkActive="active"
          class="landscape-sidebar-item"
          aria-label="View by route of administration"
        >
          <i class="pi pi-directions"></i>
          <span>Route of Admin</span>
        </a>
      </nav>
      <main class="landscape-main">
        <router-outlet />
      </main>
    </div>
  `,
})
export class LandscapeShellComponent {}
