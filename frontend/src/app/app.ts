import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, HostBinding, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  applyEntryToHolding,
  Holding,
  HoldingType,
  Ledger,
  LedgerEntry,
  EntryMode,
  EntryType,
} from './finance.models';
import { LocalStoreService } from './local-store.service';

type Page = 'overview' | 'activity' | 'holdings';
type Dialog = 'entry' | 'holding' | 'ledger' | null;
const DEFAULT_CURRENCY = 'USD';

interface MonthPoint {
  label: string;
  value: number;
  height: number;
}

@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe, FormsModule],
  templateUrl: './app.html',
})
export class App implements OnInit {
  readonly ledgers = signal<Ledger[]>([]);
  readonly entries = signal<LedgerEntry[]>([]);
  readonly holdings = signal<Holding[]>([]);
  readonly holdingTypes: HoldingType[] = ['asset', 'liability'];
  readonly selectedLedgerId = signal('');
  readonly selectedMonth = signal(monthStart(new Date()));
  readonly page = signal<Page>('overview');
  readonly dialog = signal<Dialog>(null);
  readonly storageError = signal('');
  readonly storageWarning = signal('');
  readonly notice = signal('');
  readonly loading = signal(true);
  readonly editingHoldingId = signal('');
  readonly editingLedgerId = signal('');
  readonly entryDraft: {
    mode: EntryMode;
    type: EntryType;
    amount: number | null;
    assetId: string;
    targetAssetId: string;
    category: string;
    note: string;
    date: string;
  } = this.newEntryDraft();
  readonly holdingDraft: { type: HoldingType; name: string; value: number | null } =
    this.newHoldingDraft();
  readonly ledgerDraft: { name: string; openingBalance: number | null } = {
    name: '',
    openingBalance: 0,
  };
  readonly monthEntries = computed(() => {
    const key = monthKey(this.selectedMonth());
    return this.entries()
      .filter((entry) => entry.date.startsWith(key))
      .sort((a, b) => b.date.localeCompare(a.date));
  });
  readonly monthIncome = computed(() =>
    this.monthEntries()
      .filter((entry) => (entry.mode ?? 'transaction') !== 'transfer' && entry.type === 'income')
      .reduce((sum, entry) => sum + entry.amount, 0),
  );
  readonly monthExpenses = computed(() =>
    this.monthEntries()
      .filter((entry) => (entry.mode ?? 'transaction') !== 'transfer' && entry.type === 'expense')
      .reduce((sum, entry) => sum + entry.amount, 0),
  );
  readonly carryForward = computed(() => {
    return this.holdingsForDate(previousDayKey(this.selectedMonth())).reduce(
      (sum, holding) => sum + (holding.type === 'asset' ? holding.value : 0),
      0,
    );
  });
  readonly closingCash = computed(() => this.assetTotal());
  readonly visibleHoldings = computed(() => this.holdingsForDate(monthEndKey(this.selectedMonth())));
  readonly assetTotal = computed(() =>
    this.visibleHoldings()
      .filter((holding) => holding.type === 'asset')
      .reduce((sum, holding) => sum + holding.value, 0),
  );
  readonly liabilityTotal = computed(() =>
    this.visibleHoldings()
      .filter((holding) => holding.type === 'liability')
      .reduce((sum, holding) => sum + holding.value, 0),
  );
  readonly netWorth = computed(() => this.assetTotal() - this.liabilityTotal());
  readonly worthChange = computed(() => {
    const previousEnd = monthEndKey(addMonths(this.selectedMonth(), -1));
    return this.netWorthAt(previousEnd) === null
      ? null
      : this.netWorth() - (this.netWorthAt(previousEnd) ?? 0);
  });
  readonly trend = computed<MonthPoint[]>(() => {
    const months = Array.from({ length: 6 }, (_, index) =>
      addMonths(this.selectedMonth(), index - 5),
    );
    const points = months.map((month) => ({
      label: new Intl.DateTimeFormat('en', { month: 'short' }).format(month),
      value: this.netWorthAt(monthEndKey(month)) ?? 0,
      height: 0,
    }));
    const max = Math.max(...points.map((point) => Math.abs(point.value)), 1);
    return points.map((point) => ({
      ...point,
      height: Math.max(6, (Math.abs(point.value) / max) * 100),
    }));
  });
  get entryAssets(): Holding[] {
    return this.holdings()
      .filter(
        (holding) =>
          holding.type === 'asset' &&
          (!holding.deletedAt || holding.deletedAt >= this.entryDraft.date) &&
          holding.history.some((snapshot) => snapshot.date <= this.entryDraft.date),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get entryLiabilities(): Holding[] {
    return this.holdings()
      .filter(
        (holding) =>
          holding.type === 'liability' &&
          (!holding.deletedAt || holding.deletedAt >= this.entryDraft.date) &&
          holding.history.some((snapshot) => snapshot.date <= this.entryDraft.date),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  readonly theme = signal<'light' | 'dark'>(readTheme());

  @HostBinding('attr.data-theme')
  get themeAttribute(): string {
    return this.theme();
  }

  constructor(private readonly store: LocalStoreService) {}

  ngOnInit(): void {
    document.documentElement.dataset['theme'] = this.theme();
    void this.initialize();
  }

  get activeLedger(): Ledger | undefined {
    return this.ledgers().find((ledger) => ledger.id === this.selectedLedgerId());
  }

  get pageTitle(): string {
    if (this.page() === 'activity') return 'Activity';
    if (this.page() === 'holdings') return 'Holdings';
    return 'Overview';
  }

  async initialize(): Promise<void> {
    try {
      let ledgers = await this.store.getLedgers();
      if (ledgers.length === 0) {
        const firstLedger: Ledger = {
          id: crypto.randomUUID(),
          name: 'My first ledger',
          currency: DEFAULT_CURRENCY,
          openingBalance: 0,
          createdAt: todayKey(),
        };
        await this.store.saveLedger(firstLedger);
        ledgers = [firstLedger];
      }
      this.ledgers.set(ledgers.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      this.selectedLedgerId.set(ledgers[0].id);
      await this.refreshLedgerData();
      try {
        const persistent = await this.store.requestPersistentStorage();
        if (!persistent) {
          this.storageWarning.set(
            'Your data is saved in this browser, but it may be removed by automatic storage cleanup. Download a backup regularly.',
          );
        }
      } catch (error) {
        this.storageWarning.set(
          `Could not confirm protection from browser storage cleanup. Download a backup regularly. ${errorMessage(error, '')}`,
        );
      }
    } catch (error) {
      this.storageError.set(errorMessage(error, 'Could not load your local financial data.'));
    } finally {
      this.loading.set(false);
    }
  }

  async selectLedger(id: string): Promise<void> {
    this.selectedLedgerId.set(id);
    await this.refreshLedgerData();
  }

  changePage(page: Page): void {
    this.page.set(page);
  }

  shiftMonth(amount: number): void {
    this.selectedMonth.set(addMonths(this.selectedMonth(), amount));
  }

  showDialog(dialog: Exclude<Dialog, null>): void {
    this.storageError.set('');
    this.dialog.set(dialog);
    if (dialog === 'entry') {
      Object.assign(this.entryDraft, this.newEntryDraft());
      this.entryDraft.assetId = this.entryAssets[0]?.id ?? '';
      this.entryDraft.targetAssetId =
        this.entryDraft.mode === 'payment'
          ? this.entryLiabilities[0]?.id ?? ''
          : this.entryAssets.find((asset) => asset.id !== this.entryDraft.assetId)?.id ?? '';
    }
    if (dialog === 'holding') {
      this.editingHoldingId.set('');
      Object.assign(this.holdingDraft, this.newHoldingDraft());
    }
    if (dialog === 'ledger') {
      this.editingLedgerId.set('');
      this.ledgerDraft.name = '';
      this.ledgerDraft.openingBalance = 0;
    }
  }

  closeDialog(): void {
    this.dialog.set(null);
  }

  async saveEntry(): Promise<void> {
    const amount = Number(this.entryDraft.amount);
    const mode = this.entryDraft.mode;
    const targetAssetId = this.entryDraft.targetAssetId?.trim() ?? '';
    const entryType: EntryType = mode === 'transaction' ? this.entryDraft.type : 'expense';

    if (!this.entryDraft.assetId || !this.entryAssets.some((asset) => asset.id === this.entryDraft.assetId)) {
      this.storageError.set('Choose an active asset for this entry.');
      return;
    }
    if (mode === 'payment') {
      if (!targetAssetId || !this.entryLiabilities.some((holding) => holding.id === targetAssetId)) {
        this.storageError.set('Choose the liability you are paying down.');
        return;
      }
    }
    if (mode === 'transfer') {
      if (!targetAssetId || targetAssetId === this.entryDraft.assetId) {
        this.storageError.set('Choose a different asset to transfer to.');
        return;
      }
      if (!this.entryAssets.some((asset) => asset.id === targetAssetId)) {
        this.storageError.set('Choose an active asset to transfer into.');
        return;
      }
    }
    if (!this.selectedLedgerId() || !this.entryDraft.category.trim() || !Number.isFinite(amount) || amount <= 0) {
      this.storageError.set('Enter a category and an amount greater than zero.');
      return;
    }

    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      ledgerId: this.selectedLedgerId(),
      assetId: this.entryDraft.assetId,
      targetAssetId: mode === 'transaction' ? undefined : targetAssetId || undefined,
      type: entryType,
      mode,
      amount: cents(amount),
      category: this.entryDraft.category.trim(),
      note: this.entryDraft.note.trim(),
      date: this.entryDraft.date,
      createdAt: new Date().toISOString(),
    };
    await this.persist(async () => {
      await this.store.saveEntry(entry);
      this.holdings.update((holdings) =>
        holdings.map((holding) => {
          if (holding.id === entry.assetId || holding.id === entry.targetAssetId) {
            return applyEntryToHolding(holding, entry);
          }
          return holding;
        }),
      );
      this.entries.update((entries) => [...entries, entry]);
      this.notice.set(`${this.entryLabel(entry.mode ?? 'transaction')} added to ${this.activeLedger?.name}.`);
    });
  }

  async removeEntry(entry: LedgerEntry): Promise<void> {
    if (!globalThis.confirm(`Delete this ${this.entryLabel(entry.mode ?? 'transaction')} entry?`)) return;
    await this.persist(async () => {
      await this.store.deleteEntry(entry);
      this.holdings.update((holdings) =>
        holdings.map((holding) => {
          if (holding.id === entry.assetId || holding.id === entry.targetAssetId) {
            return applyEntryToHolding(holding, entry, -1);
          }
          return holding;
        }),
      );
      this.entries.update((entries) => entries.filter((item) => item.id !== entry.id));
      this.notice.set('Entry deleted.');
    });
  }

  async saveHolding(): Promise<void> {
    const name = this.holdingDraft.name.trim();
    const value = Number(this.holdingDraft.value);
    if (!name || !Number.isFinite(value) || value < 0) {
      this.storageError.set('Enter a name and a value of zero or more.');
      return;
    }

    const date = todayKey();
    const existing = this.holdings().find((holding) => holding.id === this.editingHoldingId());
    if (existing?.system) {
      this.storageError.set('The opening cash asset is managed by the ledger.');
      return;
    }
    if (
      existing?.type === 'asset' &&
      this.holdingDraft.type !== 'asset' &&
      this.entries().some((entry) => entry.assetId === existing.id)
    ) {
      this.storageError.set('An asset used by entries cannot be changed into a liability.');
      return;
    }
    const history = existing ? existing.history.map((snapshot) => ({ ...snapshot })) : [];
    const recordedAt = new Date().toISOString();
    const latest = history
      .filter((snapshot) => snapshot.date === date)
      .sort((a, b) => (b.recordedAt ?? '').localeCompare(a.recordedAt ?? ''))[0];
    if (latest) {
      latest.value = cents(value);
      latest.recordedAt = recordedAt;
    } else {
      history.push({ date, value: cents(value), recordedAt });
    }
    const holding: Holding = {
      id: existing?.id ?? crypto.randomUUID(),
      ledgerId: this.selectedLedgerId(),
      type: this.holdingDraft.type,
      name,
      history,
    };
    await this.persist(async () => {
      await this.store.saveHolding(holding);
      this.notice.set(`${capitalize(holding.type)} saved.`);
    });
  }

  editHolding(holding: Holding): void {
    if (holding.system) return;
    const value = this.holdingValueAt(holding, todayKey());
    this.editingHoldingId.set(holding.id);
    this.holdingDraft.type = holding.type;
    this.holdingDraft.name = holding.name;
    this.holdingDraft.value = value;
    this.storageError.set('');
    this.dialog.set('holding');
  }

  async removeHolding(holding: Holding): Promise<void> {
    if (holding.system) {
      this.storageError.set('The opening cash asset is required by this ledger.');
      return;
    }
    if (!globalThis.confirm(`Remove ${holding.name} from this ledger? Its earlier values will remain in history.`)) {
      return;
    }
    await this.persist(async () => {
      await this.store.saveHolding({ ...holding, deletedAt: todayKey() });
      this.notice.set(`${holding.name} removed.`);
    });
  }

  async saveLedger(): Promise<void> {
    const name = this.ledgerDraft.name.trim();
    const openingBalance = Number(this.ledgerDraft.openingBalance);
    if (!name || !Number.isFinite(openingBalance)) {
      this.storageError.set('Enter a ledger name and a valid opening balance.');
      return;
    }

    const ledger: Ledger = {
      id: this.editingLedgerId() || crypto.randomUUID(),
      name,
      currency: this.editingLedgerId()
        ? this.activeLedger?.currency ?? DEFAULT_CURRENCY
        : DEFAULT_CURRENCY,
      openingBalance: cents(openingBalance),
      createdAt: this.editingLedgerId()
        ? this.activeLedger?.createdAt ?? todayKey()
        : todayKey(),
    };
    try {
      const cashAsset = this.openingCashAsset(ledger);
      await this.store.saveLedgerWithOpeningAsset(ledger, cashAsset);
      if (this.editingLedgerId()) {
        this.ledgers.update((ledgers) =>
          ledgers.map((item) => (item.id === ledger.id ? ledger : item)),
        );
        this.holdings.update((holdings) =>
          holdings.some((holding) => holding.id === cashAsset.id)
            ? holdings.map((holding) => (holding.id === cashAsset.id ? cashAsset : holding))
            : [...holdings, cashAsset],
        );
        this.notice.set(`${ledger.name} updated.`);
      } else {
        this.ledgers.update((ledgers) => [...ledgers, ledger]);
        this.selectedLedgerId.set(ledger.id);
        this.entries.set([]);
        this.holdings.set([cashAsset]);
        this.notice.set(`${ledger.name} created. Its data is kept separate.`);
      }
      this.dialog.set(null);
      await this.refreshLedgerData();
    } catch (error) {
      this.storageError.set(errorMessage(error, 'Could not save this ledger.'));
    }
  }

  editLedger(): void {
    const ledger = this.activeLedger;
    if (!ledger) return;
    this.editingLedgerId.set(ledger.id);
    this.ledgerDraft.name = ledger.name;
    this.ledgerDraft.openingBalance = ledger.openingBalance;
    this.storageError.set('');
    this.dialog.set('ledger');
  }

  exportBackup(): void {
    void this.createBackup();
  }

  getMonthIncome(): number {
    return this.monthIncome();
  }

  getMonthExpenses(): number {
    return this.monthExpenses();
  }

  formatMonth(date: Date): string {
    return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date);
  }

  monthIsCurrent(): boolean {
    return monthKey(this.selectedMonth()) === monthKey(new Date());
  }

  goToThisMonth(): void {
    this.selectedMonth.set(monthStart(new Date()));
  }

  holdingsOfType(type: HoldingType): Array<Holding & { value: number }> {
    return this.visibleHoldings().filter((holding) => holding.type === type);
  }

  entryAssetName(assetId: string | undefined): string {
    return this.holdings().find((holding) => holding.id === assetId)?.name ?? 'Asset';
  }

  entryLabel(mode: EntryMode | EntryType): string {
    if (mode === 'payment') return 'Payment';
    if (mode === 'transfer') return 'Transfer';
    if (mode === 'transaction') return 'Transaction';
    return capitalize(mode);
  }

  selectEntryAsset(assetId: string): void {
    this.entryDraft.assetId = assetId;
  }

  toggleTheme(): void {
    const next = this.theme() === 'light' ? 'dark' : 'light';
    this.theme.set(next);
    document.documentElement.dataset['theme'] = next;
    try {
      localStorage.setItem('finnager-theme', next);
    } catch (error) {
      this.storageError.set(errorMessage(error, 'Could not save your theme preference.'));
    }
  }

  private async refreshLedgerData(): Promise<void> {
    const ledgerId = this.selectedLedgerId();
    if (!ledgerId) return;
    try {
      const ledger = this.ledgers().find((item) => item.id === ledgerId);
      if (!ledger) return;
      let [entries, holdings] = await Promise.all([
        this.store.getEntries(ledgerId),
        this.store.getHoldings(ledgerId),
      ]);
      const hasUnassignedEntries = entries.some((entry) => !entry.assetId);
      const hasCash = holdings.some(
        (holding) => holding.type === 'asset' && (holding.system || holding.name === 'Cash'),
      );
      if (!hasCash || hasUnassignedEntries) {
        let cash = holdings.find((holding) => holding.type === 'asset' && holding.name === 'Cash');
        if (!cash) {
          cash = {
            id: crypto.randomUUID(),
            ledgerId,
            type: 'asset',
            name: 'Cash',
            history: [
              {
                date: '0001-01-01',
                value: ledger.openingBalance,
                recordedAt: '0001-01-01T00:00:00.000Z',
              },
            ],
          };
          await this.store.saveHolding(cash);
        } else if (!cash.system) {
          cash = { ...cash, system: true };
          await this.store.saveHolding(cash);
        }
        await this.store.assignEntriesToAsset(entries, cash.id);
        [entries, holdings] = await Promise.all([
          this.store.getEntries(ledgerId),
          this.store.getHoldings(ledgerId),
        ]);
      }
      this.entries.set(entries);
      this.holdings.set(holdings);
      this.storageError.set('');
    } catch (error) {
      this.storageError.set(errorMessage(error, 'Could not load data for this ledger.'));
    }
  }

  private openingCashAsset(ledger: Ledger): Holding {
    const existing = this.holdings().find(
      (holding) =>
        holding.ledgerId === ledger.id &&
        holding.type === 'asset' &&
        (holding.system || holding.name === 'Cash'),
    );
    const initialValue = this.editingLedgerId()
      ? this.activeLedger?.openingBalance ?? ledger.openingBalance
      : ledger.openingBalance;
    const delta = ledger.openingBalance - initialValue;
    const history = existing
      ? existing.history.map((snapshot) => ({
          ...snapshot,
          value: cents(snapshot.value + delta),
        }))
      : [
          {
            date: '0001-01-01',
            value: ledger.openingBalance,
            recordedAt: '0001-01-01T00:00:00.000Z',
          },
        ];
    const baseline = history.find((snapshot) => snapshot.date === '0001-01-01');
    if (!baseline) {
      history.push({
        date: '0001-01-01',
        value: ledger.openingBalance,
        recordedAt: '0001-01-01T00:00:00.000Z',
      });
    }

    return {
      id: existing?.id ?? crypto.randomUUID(),
      ledgerId: ledger.id,
      type: 'asset',
      name: 'Cash',
      history,
      system: true,
    };
  }

  private async persist(operation: () => Promise<void>): Promise<void> {
    this.storageError.set('');
    try {
      await operation();
      this.closeDialog();
      await this.refreshLedgerData();
    } catch (error) {
      this.storageError.set(errorMessage(error, 'Could not save your changes.'));
    }
  }

  private holdingsForDate(date: string): Array<Holding & { value: number }> {
    return this.holdings()
      .filter((holding) => !holding.deletedAt || holding.deletedAt > date)
      .flatMap((holding) => {
        const value = this.holdingValueAt(holding, date);
        return value === null ? [] : [{ ...holding, value }];
      });
  }

  private holdingValueAt(holding: Holding, date: string): number | null {
    const snapshot = holding.history
      .filter((snapshot) => snapshot.date <= date)
      .sort((a, b) => {
        const byDate = b.date.localeCompare(a.date);
        return byDate || (b.recordedAt ?? '').localeCompare(a.recordedAt ?? '');
      })[0];
    if (!snapshot) return null;

    const baselineAt = snapshot.recordedAt ?? `${snapshot.date}T00:00:00.000Z`;
    const activity = this.entries()
      .filter(
        (entry) =>
          (entry.assetId === holding.id || entry.targetAssetId === holding.id) &&
          entry.date <= date &&
          (entry.date > snapshot.date ||
            (entry.date === snapshot.date &&
              (entry.createdAt ?? `${entry.date}T23:59:59.999Z`) > baselineAt)),
      )
      .reduce((sum, entry) => {
        if (entry.assetId === holding.id) {
          const sourceDelta = entry.mode === 'transfer' ? -entry.amount : entry.type === 'income' ? entry.amount : -entry.amount;
          return sum + sourceDelta;
        }
        if (entry.targetAssetId === holding.id) {
          if (entry.mode === 'transfer') return sum + entry.amount;
          if (entry.mode === 'payment') return sum - entry.amount;
        }
        return sum;
      }, 0);
    return cents(snapshot.value + activity);
  }

  private netWorthAt(date: string): number | null {
    const holdings = this.holdingsForDate(date);
    const assets = holdings
      .filter((holding) => holding.type === 'asset')
      .reduce((sum, holding) => sum + holding.value, 0);
    const liabilities = holdings
      .filter((holding) => holding.type === 'liability')
      .reduce((sum, holding) => sum + holding.value, 0);
    return assets - liabilities;
  }

  private newEntryDraft(): typeof this.entryDraft {
    return {
      mode: 'transaction',
      type: 'expense',
      amount: null,
      assetId: '',
      targetAssetId: '',
      category: '',
      note: '',
      date: todayKey(),
    };
  }

  private newHoldingDraft(): typeof this.holdingDraft {
    return { type: 'asset', name: '', value: null };
  }

  private async createBackup(): Promise<void> {
    try {
      const [entries, holdings] = await Promise.all([
        this.store.getAllEntries(),
        this.store.getAllHoldings(),
      ]);
      const backup = {
        app: 'Finnager',
        version: 1,
        exportedAt: new Date().toISOString(),
        ledgers: this.ledgers(),
        entries,
        holdings,
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `finnager-backup-${todayKey()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.notice.set('Your local backup has been downloaded.');
    } catch (error) {
      this.storageError.set(errorMessage(error, 'Could not create a backup.'));
    }
  }
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthEndKey(date: Date): string {
  return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function previousDayKey(date: Date): string {
  return todayKey(new Date(date.getFullYear(), date.getMonth(), 0));
}

function todayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function readTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('finnager-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Theme preference is optional; use the device preference if storage is unavailable.
  }
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
