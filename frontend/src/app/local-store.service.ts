import { Injectable } from '@angular/core';
import { Holding, Ledger, LedgerEntry } from './finance.models';

const DATABASE_NAME = 'finnager-local';
const DATABASE_VERSION = 1;

@Injectable({ providedIn: 'root' })
export class LocalStoreService {
  private database?: Promise<IDBDatabase>;

  getLedgers(): Promise<Ledger[]> {
    return this.request('ledgers', 'readonly', (store) => store.getAll());
  }

  async saveLedger(ledger: Ledger): Promise<void> {
    await this.request('ledgers', 'readwrite', (store) => store.put(ledger));
  }

  async saveLedgerWithOpeningAsset(ledger: Ledger, openingAsset: Holding): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['ledgers', 'holdings'], 'readwrite');
      transaction.objectStore('ledgers').put(ledger);
      transaction.objectStore('holdings').put(openingAsset);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Local storage transaction was aborted.'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Could not save this ledger.'));
    });
  }

  getEntries(ledgerId: string): Promise<LedgerEntry[]> {
    return this.request('entries', 'readonly', (store) =>
      store.index('ledgerId').getAll(IDBKeyRange.only(ledgerId)),
    );
  }

  getAllEntries(): Promise<LedgerEntry[]> {
    return this.request('entries', 'readonly', (store) => store.getAll());
  }

  async saveEntry(entry: LedgerEntry): Promise<void> {
    if (!entry.assetId) {
      throw new Error('Choose an asset for this entry.');
    }
    const assetId = entry.assetId;

    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['entries', 'holdings'], 'readwrite');
      const entries = transaction.objectStore('entries');
      const holdings = transaction.objectStore('holdings');
      const holdingRequest = holdings.get(assetId);

      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Local storage transaction was aborted.'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Could not save this entry.'));

      holdingRequest.onsuccess = () => {
        const holding = holdingRequest.result as Holding | undefined;
        if (!holding || holding.ledgerId !== entry.ledgerId || holding.type !== 'asset') {
          transaction.abort();
          reject(new Error('Choose an asset in this ledger.'));
          return;
        }

        const signedAmount = entry.type === 'income' ? entry.amount : -entry.amount;
        const recordedAt = entry.createdAt ?? new Date().toISOString();
        const history = holding.history.map((snapshot) => {
          const recordedAtSnapshot = snapshot.recordedAt ?? `${snapshot.date}T00:00:00.000Z`;
          const snapshotIncludesEntry =
            entry.date < snapshot.date ||
            (entry.date === snapshot.date && recordedAt <= recordedAtSnapshot);
          return snapshotIncludesEntry
            ? { ...snapshot, value: roundCents(snapshot.value + signedAmount) }
            : snapshot;
        });

        holdings.put({ ...holding, history });
        entries.put({ ...entry, createdAt: recordedAt });
      };

      holdingRequest.onerror = () => {
        reject(holdingRequest.error ?? new Error('Could not find the selected asset.'));
      };
    });
  }

  async assignEntriesToAsset(entries: LedgerEntry[], assetId: string): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('entries', 'readwrite');
      const store = transaction.objectStore('entries');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Local storage transaction was aborted.'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Could not update older entries.'));
      for (const entry of entries) {
        if (!entry.assetId) store.put({ ...entry, assetId });
      }
    });
  }

  async deleteEntry(entry: LedgerEntry): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['entries', 'holdings'], 'readwrite');
      const entries = transaction.objectStore('entries');
      const holdings = transaction.objectStore('holdings');
      const entryRequest = entries.get(entry.id);

      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Local storage transaction was aborted.'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Could not delete this entry.'));

      entryRequest.onsuccess = () => {
        const storedEntry = entryRequest.result as LedgerEntry | undefined;
        if (!storedEntry) return;
        entries.delete(storedEntry.id);
        if (!storedEntry.assetId) return;

        const holdingRequest = holdings.get(storedEntry.assetId);
        holdingRequest.onsuccess = () => {
          const holding = holdingRequest.result as Holding | undefined;
          if (!holding) return;
          const signedAmount = storedEntry.type === 'income' ? storedEntry.amount : -storedEntry.amount;
          const recordedAt = storedEntry.createdAt ?? new Date().toISOString();
          const history = holding.history.map((snapshot) => {
            const recordedAtSnapshot = snapshot.recordedAt ?? `${snapshot.date}T00:00:00.000Z`;
            const snapshotIncludesEntry =
              storedEntry.date < snapshot.date ||
              (storedEntry.date === snapshot.date && recordedAt <= recordedAtSnapshot);
            return snapshotIncludesEntry
              ? { ...snapshot, value: roundCents(snapshot.value - signedAmount) }
              : snapshot;
          });
          holdings.put({ ...holding, history });
        };
        holdingRequest.onerror = () => {
          reject(holdingRequest.error ?? new Error('Could not update the selected asset.'));
        };
      };
      entryRequest.onerror = () => {
        reject(entryRequest.error ?? new Error('Could not load the entry to delete.'));
      };
    });
  }

  getHoldings(ledgerId: string): Promise<Holding[]> {
    return this.request('holdings', 'readonly', (store) =>
      store.index('ledgerId').getAll(IDBKeyRange.only(ledgerId)),
    );
  }

  getAllHoldings(): Promise<Holding[]> {
    return this.request('holdings', 'readonly', (store) => store.getAll());
  }

  async saveHolding(holding: Holding): Promise<void> {
    await this.request('holdings', 'readwrite', (store) => store.put(holding));
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) {
      return Promise.reject(new Error('This browser does not support local IndexedDB storage.'));
    }

    this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('ledgers', { keyPath: 'id' });

        const entries = database.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('ledgerId', 'ledgerId');

        const holdings = database.createObjectStore('holdings', { keyPath: 'id' });
        holdings.createIndex('ledgerId', 'ledgerId');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'));
      request.onblocked = () => reject(new Error('Local storage is blocked by another open app tab.'));
    });

    return this.database;
  }

  private async request<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let result!: T;

      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Local storage transaction was aborted.'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Local storage transaction failed.'));

      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () =>
        reject(request.error ?? new Error('Could not complete the local storage request.'));
    });
  }
}

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
