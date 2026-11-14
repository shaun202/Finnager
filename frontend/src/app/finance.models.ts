export type EntryType = 'income' | 'expense';
export type EntryMode = 'transaction' | 'payment' | 'transfer';
export type HoldingType = 'asset' | 'liability';
export type InterestKind = 'flat' | 'tiered';

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
  targetAssetId?: string;
  type: EntryType;
  mode?: EntryMode;
  amount: number;
  category: string;
  note: string;
  date: string;
  createdAt?: string;
}

export interface InterestThreshold {
  id: string;
  minimum: number;
  rate: number;
}

export interface HoldingInterest {
  enabled: boolean;
  kind: InterestKind;
  rate: number;
  thresholds: InterestThreshold[];
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
  interest?: HoldingInterest;
  deletedAt?: string;
  system?: boolean;
}

export function applyEntryToHolding(
  holding: Holding,
  entry: LedgerEntry,
  direction: 1 | -1 = 1,
): Holding {
  const deltaForHolding = (holdingId: string): number => {
    if (entry.assetId === holdingId) {
      if (entry.mode === 'transfer') {
        return -entry.amount * direction;
      }
      return ((entry.type === 'income' ? entry.amount : -entry.amount) * direction);
    }
    if (entry.targetAssetId === holdingId) {
      if (entry.mode === 'transfer') {
        return entry.amount * direction;
      }
      if (entry.mode === 'payment') {
        return -entry.amount * direction;
      }
    }
    return 0;
  };

  const signedAmount = deltaForHolding(holding.id);
  const recordedAt = entry.createdAt ?? new Date().toISOString();
  const history = holding.history.map((snapshot) => {
    const recordedAtSnapshot = snapshot.recordedAt ?? `${snapshot.date}T00:00:00.000Z`;
    const snapshotIncludesEntry =
      entry.date < snapshot.date ||
      (entry.date === snapshot.date && recordedAt <= recordedAtSnapshot);
    return snapshotIncludesEntry
      ? {
          ...snapshot,
          value: Math.round((snapshot.value + signedAmount + Number.EPSILON) * 100) / 100,
        }
      : snapshot;
  });

  return { ...holding, history };
}
