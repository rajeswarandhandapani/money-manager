// Manages DaisyUI theme switching with OS auto-fallback ('system') and localStorage persistence.

import { Injectable, signal } from '@angular/core';

export const KIT_THEMES = [
  { id: 'system', label: 'System auto (Nord / Dim)' },
  { id: 'nord', label: 'Nord (Light)' },
  { id: 'light', label: 'Light' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'winter', label: 'Winter' },
  { id: 'dim', label: 'Dim (Dark)' },
  { id: 'dark', label: 'Dark' },
  { id: 'sunset', label: 'Sunset (Dark)' },
] as const;

export type KitThemeId = (typeof KIT_THEMES)[number]['id'];

const STORAGE_KEY = 'pwa-kit-theme';
const VALID_IDS = new Set<string>(KIT_THEMES.map(t => t.id));

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<KitThemeId>(this.readStored());

  constructor() {
    this.apply(this.theme());
  }

  setTheme(next: string): void {
    const valid: KitThemeId = VALID_IDS.has(next) ? (next as KitThemeId) : 'system';
    this.theme.set(valid);
    this.apply(valid);
    try {
      if (valid === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, valid);
    } catch { }
  }

  private readStored(): KitThemeId {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && VALID_IDS.has(saved)) return saved as KitThemeId;
    } catch { }
    return 'system';
  }

  private apply(id: KitThemeId): void {
    if (typeof document === 'undefined') return;
    if (id === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', id);
  }
}
