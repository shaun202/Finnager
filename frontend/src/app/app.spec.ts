import { ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';
import { Holding, Ledger, LedgerEntry } from './finance.models';
import { LocalStoreService } from './local-store.service';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let app: App;
  let store: jasmine.SpyObj<LocalStoreService>;

  beforeEach(async () => {
    store = jasmine.createSpyObj<LocalStoreService>('LocalStoreService', [
      'getLedgers',
      'saveLedger',
      'saveLedgerWithOpeningAsset',
      'getEntries',
      'getAllEntries',
      'saveEntry',
      'assignEntriesToAsset',
      'deleteEntry',
      'getHoldings',
      'getAllHoldings',
      'saveHolding',
    ]);
    store.getLedgers.and.resolveTo([]);
    store.saveLedger.and.resolveTo();
    store.saveLedgerWithOpeningAsset.and.resolveTo();
    store.saveHolding.and.resolveTo();
    store.assignEntriesToAsset.and.resolveTo();
    store.getEntries.and.resolveTo([]);
    store.getHoldings.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: LocalStoreService, useValue: store }],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    delete document.documentElement.dataset['theme'];
    localStorage.removeItem('finnager-theme');
  });

  it('creates a default ledger when local storage is empty', async () => {
    await app.initialize();

    expect(store.saveLedger).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ name: 'My first ledger', currency: 'USD', openingBalance: 0 }),
    );
    expect(app.ledgers().length).toBe(1);
    expect(app.selectedLedgerId()).toBe(app.ledgers()[0].id);
  });

  it('loads only the selected ledger data', async () => {
    const first = ledger('personal');
    const second = ledger('travel');
    const personalEntry = entry(first.id, 100, 'income', '2026-11-01', 'cash');
    const travelEntry = entry(second.id, 25, 'income', '2026-11-01', 'cash');
    app.ledgers.set([first, second]);
    app.selectedLedgerId.set(first.id);
    const travelCash = holding(second.id, 'asset', [
      { date: '0001-01-01', value: 0, recordedAt: '0001-01-01T00:00:00.000Z' },
    ], 'cash');
    travelCash.name = 'Cash';
    app.holdings.set([travelCash]);
    store.getHoldings.and.resolveTo([travelCash]);
    store.getEntries.and.callFake(async (ledgerId: string) =>
      ledgerId === second.id ? [travelEntry] : [personalEntry],
    );

    await app.selectLedger(second.id);

    expect(store.getEntries).toHaveBeenCalledOnceWith(second.id);
    expect(app.entries()).toEqual([travelEntry]);
    expect(app.monthIncome()).toBe(25);
  });

  it('carries prior cash forward without clearing monthly history', () => {
    const currentLedger = ledger('main', 100);
    app.ledgers.set([currentLedger]);
    app.selectedLedgerId.set(currentLedger.id);
    app.selectedMonth.set(new Date(2026, 1, 1));
    app.entries.set([
      entry(currentLedger.id, 50, 'income', '2026-01-12', 'cash'),
      entry(currentLedger.id, 20, 'expense', '2026-01-18', 'cash'),
      entry(currentLedger.id, 30, 'income', '2026-02-04', 'cash'),
      entry(currentLedger.id, 10, 'expense', '2026-02-06', 'cash'),
    ]);
    app.holdings.set([holding(currentLedger.id, 'asset', [
      { date: '0001-01-01', value: 100, recordedAt: '0001-01-01T00:00:00.000Z' },
    ], 'cash')]);

    expect(app.carryForward()).toBe(130);
    expect(app.monthIncome()).toBe(30);
    expect(app.monthExpenses()).toBe(10);
    expect(app.closingCash()).toBe(150);
    expect(app.entries().length).toBe(4);
  });

  it('uses dated asset and liability values for historical net worth', () => {
    const currentLedger = ledger('main');
    app.ledgers.set([currentLedger]);
    app.selectedLedgerId.set(currentLedger.id);
    app.selectedMonth.set(new Date(2026, 1, 1));
    app.holdings.set([
      holding(currentLedger.id, 'asset', [
        { date: '2026-01-10', value: 80 },
        { date: '2026-03-10', value: 120 },
      ]),
      holding(currentLedger.id, 'liability', [{ date: '2026-01-15', value: 15 }]),
    ]);

    expect(app.assetTotal()).toBe(80);
    expect(app.liabilityTotal()).toBe(15);
    expect(app.netWorth()).toBe(65);
  });

  it('applies income and expenses to the asset they reference', () => {
    const currentLedger = ledger('main');
    app.ledgers.set([currentLedger]);
    app.selectedLedgerId.set(currentLedger.id);
    app.selectedMonth.set(new Date(2026, 1, 1));
    app.holdings.set([holding(currentLedger.id, 'asset', [
      { date: '2026-01-01', value: 200, recordedAt: '2026-01-01T00:00:00.000Z' },
    ], 'savings')]);
    app.entries.set([
      entry(currentLedger.id, 75, 'income', '2026-02-03', 'savings'),
      entry(currentLedger.id, 25, 'expense', '2026-02-08', 'savings'),
      entry(currentLedger.id, 90, 'expense', '2026-02-09', 'other'),
    ]);

    expect(app.assetTotal()).toBe(250);
    expect(app.netWorth()).toBe(250);
  });

  it('keeps overview focused and places worth metrics on holdings', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.overview-metrics .metric-card').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.worth-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mobile-ledger-controls')).not.toBeNull();

    app.changePage('holdings');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.worth-card')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.trend-panel')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.carry-panel')).not.toBeNull();
  });

  it('applies the prototype dark palette to the page and dashboard cards', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    document.body.appendChild(fixture.nativeElement);
    if (app.theme() !== 'dark') app.toggleTheme();
    fixture.detectChanges();

    expect(fixture.nativeElement.getAttribute('data-theme')).toBe('dark');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim()).toBe('#070e08');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim()).toBe('#206934');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()).toBe('#e7e9e7');
  });
});

function ledger(id: string, openingBalance = 0): Ledger {
  return { id, name: id, currency: 'USD', openingBalance, createdAt: '2026-01-01' };
}

function entry(
  ledgerId: string,
  amount: number,
  type: LedgerEntry['type'] = 'income',
  date = '2026-11-01',
  assetId?: string,
): LedgerEntry {
  return {
    id: `${ledgerId}-${date}-${amount}`,
    ledgerId,
    assetId,
    amount,
    type,
    category: 'Test',
    note: '',
    date,
    createdAt: `${date}T12:00:00.000Z`,
  };
}

function holding(
  ledgerId: string,
  type: Holding['type'],
  history: Holding['history'],
  id = `${ledgerId}-${type}`,
): Holding {
  return { id, ledgerId, type, name: type, history };
}
