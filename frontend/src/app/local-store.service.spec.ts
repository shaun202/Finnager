import { Ledger } from './finance.models';
import { LocalStoreService } from './local-store.service';

describe('LocalStoreService persistence', () => {
  it('retains a saved ledger for a new store instance', async () => {
    const ledger: Ledger = {
      id: `persistence-test-${crypto.randomUUID()}`,
      name: 'Persistence test',
      currency: 'USD',
      openingBalance: 0,
      createdAt: '2026-01-01',
    };

    try {
      await new LocalStoreService().saveLedger(ledger);

      const ledgers = await new LocalStoreService().getLedgers();
      expect(ledgers).toContain(jasmine.objectContaining(ledger));
    } finally {
      await deleteLedger(ledger.id);
    }
  });
});

function deleteLedger(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('finnager-local', 1);
    request.onerror = () => reject(request.error ?? new Error('Could not open test database.'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('ledgers', 'readwrite');
      transaction.objectStore('ledgers').delete(id);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error('Could not clean up test ledger.'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error('Could not clean up test ledger.'));
      };
    };
  });
}
