import { Injectable, signal } from '@angular/core';
import type { SplitPartInput } from '../domain/classify';
import type { TransactionRow } from '../domain/models';
import type { ParsedCsvExport } from '../domain/parse';

export interface PromptOptions {
  label?: string;
  type?: 'text' | 'password';
  action?: string;
  note?: string;
}

export interface PromptRequest extends PromptOptions {
  title: string;
  resolve: (value: string | null) => void;
}

export interface RecoveryRequest {
  code: string;
  resolve: (confirmed: boolean) => void;
}

export interface SplitRequest {
  parent: TransactionRow;
  siblings: TransactionRow[];
  isPending: boolean;
  onSave: (parts: SplitPartInput[], previous: TransactionRow[]) => Promise<void>;
  resolve: (saved: boolean) => void;
}

export interface MapperRequest {
  file: ParsedCsvExport;
  resolve: (saved: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class MoneyModalsService {
  readonly promptState = signal<PromptRequest | null>(null);
  readonly promptValue = signal('');
  readonly recoveryState = signal<RecoveryRequest | null>(null);
  readonly budgetsOpen = signal(false);
  readonly addTxOpen = signal(false);
  readonly splitState = signal<SplitRequest | null>(null);
  readonly mapperState = signal<MapperRequest | null>(null);

  askText(title: string, opts: PromptOptions = {}): Promise<string | null> {
    if (this.promptState()) {
      this.promptState()!.resolve(null);
    }
    this.promptValue.set('');
    return new Promise(resolve => {
      this.promptState.set({ title, ...opts, resolve });
    });
  }

  closePrompt(value: string | null): void {
    const cur = this.promptState();
    this.promptState.set(null);
    this.promptValue.set('');
    cur?.resolve(value);
  }

  showRecoveryCode(code: string): Promise<boolean> {
    if (this.recoveryState()) {
      this.recoveryState()!.resolve(false);
    }
    return new Promise(resolve => {
      this.recoveryState.set({ code, resolve });
    });
  }

  closeRecovery(confirmed: boolean): void {
    const cur = this.recoveryState();
    this.recoveryState.set(null);
    cur?.resolve(confirmed);
  }

  openBudgets(): void {
    this.budgetsOpen.set(true);
  }

  closeBudgets(): void {
    this.budgetsOpen.set(false);
  }

  openAddTx(): void {
    this.addTxOpen.set(true);
  }

  closeAddTx(): void {
    this.addTxOpen.set(false);
  }

  openSplit(req: Omit<SplitRequest, 'resolve'>): Promise<boolean> {
    if (this.splitState()) {
      this.splitState()!.resolve(false);
    }
    return new Promise(resolve => {
      this.splitState.set({ ...req, resolve });
    });
  }

  closeSplit(saved: boolean): void {
    const cur = this.splitState();
    this.splitState.set(null);
    cur?.resolve(saved);
  }

  openMapper(file: ParsedCsvExport): Promise<boolean> {
    if (this.mapperState()) {
      this.mapperState()!.resolve(false);
    }
    return new Promise(resolve => {
      this.mapperState.set({ file, resolve });
    });
  }

  closeMapper(saved: boolean): void {
    const cur = this.mapperState();
    this.mapperState.set(null);
    cur?.resolve(saved);
  }
}
