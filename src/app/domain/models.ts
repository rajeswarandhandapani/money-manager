export type TxKind = 'expense' | 'income' | 'savings' | 'transfer';
export type AmountMode = 'signed' | 'debitCredit' | 'amountType';

export interface TransactionRow {
  id: string;
  account: string;
  accountType: string;
  date: string;
  desc: string;
  origDesc?: string;
  cents: number;
  origCents?: number;
  bankCategory: string;
  bankType: string;
  kind: TxKind;
  cat: string;
  sub: string;
  needsReview: boolean;
  edited: boolean;
  batch?: string;
  splitOf?: string;
  splitIndex?: number;
  splitParent?: TransactionRow;
}

export interface RuleChoice {
  kind: TxKind;
  cat: string;
  sub: string;
  rowId: string;
}

export interface MerchantRule {
  key: string;
  votes: Record<string, number>;
  manual: RuleChoice | null;
  mixed?: boolean;
  storeDefault?: boolean;
}

export type RuleMap = Record<string, MerchantRule>;
export type CategoryMap = Record<string, string[]>;
export type BudgetMap = Record<string, number>;

export interface CsvMapConfig {
  id?: string;
  account: string;
  accountType: string;
  headers?: string[];
  date: string;
  desc: string;
  amountMode: AmountMode;
  amount?: string;
  debit?: string;
  credit?: string;
  type?: string;
  spendSign?: number;
  category?: string;
  cardColumn?: string;
  custom?: boolean;
}

export interface RawTransactionRow {
  id: string;
  account: string;
  accountType: string;
  date: string;
  desc: string;
  cents: number;
  bankCategory: string;
  bankType: string;
}

export interface ImportProblem {
  line: number;
  text: string;
}

export interface ImportBatch {
  id: string;
  at: string;
  files: string[];
  count: number;
}

export interface LockRecord {
  userId: Uint8Array;
  credentialId?: ArrayBuffer;
  salt?: Uint8Array;
  hash?: string;
}
