export type EntryType = 'income' | 'expense';
export type HoldingType = 'asset' | 'liability';

export interface Ledger {
  id: string;
  name: string;
  currency: string;
  openingBalance: number;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  ledgerId: string;
  assetId?: string;
  type: EntryType;
  amount: number;
  category: string;
  note: string;
  date: string;
  createdAt?: string;
}

export interface HoldingValue {
  date: string;
  value: number;
  recordedAt?: string;
}

export interface Holding {
  id: string;
  ledgerId: string;
  type: HoldingType;
  name: string;
  history: HoldingValue[];
  deletedAt?: string;
  system?: boolean;
}
