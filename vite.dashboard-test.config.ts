import { defineConfig, type Plugin } from 'vite';

const virtual = (name: string) => `\0depositcraft-dashboard-test:${name}`;

function wixServiceMocks(): Plugin {
  const pageImports: Record<string, string> = {
    '../../shared/configuration': 'configuration',
    '../../shared/logger': 'logger',
    '../../shared/installment-billing': 'installment-billing',
  };

  const mocks: Record<string, string> = {
    'app-management': `
      export const billing = {};
      export const biEvents = { sendBiEvent: () => Promise.resolve() };
      export const appInstances = {
        getAppInstance: () => {
          const isPaid = new URLSearchParams(window.location.search).get('plan') === 'paid';
          return Promise.resolve({
            site: { siteId: '00000000-0000-0000-0000-000000000000' },
            instance: { isFree: !isPaid }
          });
        }
      };
    `,
    logger: `
      export const emitDiagnostic = () => {};
      export const markSetupFinished = () => {};
      export const markDashboardLoaded = () => {};
      export class AppLogger {
        time(a, fn) { return fn(); }
        info() {}
        warn() {}
        error() {}
        trackUsage() {}
      }
      export const logger = new AppLogger('depositcraft');
    `,
    essentials: `
      export const auth = {
        elevate: (fn) => fn,
      };
      export const i18n = {
        getLanguage: () => new URLSearchParams(window.location.search).get('lang') || 'en',
        getLocale: () => new URLSearchParams(window.location.search).get('lang') || 'en',
      };
    `,
    configuration: `
      const defaultRules = [
        {
          id: 'luxury-furniture-layaway',
          name: 'Luxury Furniture Layaway Plan',
          depositType: 'PERCENTAGE',
          depositValue: 25,
          layawayInstallments: 4,
          installmentFrequency: 'BIWEEKLY',
          minOrderSubtotal: 500,
          scope: 'ALL_PRODUCTS',
          enabled: true,
          description: '25% upfront deposit with remaining balance divided into 4 bi-weekly payments',
        },
        {
          id: 'custom-jewelry-deposit',
          name: 'Custom Jewelry & Rings Deposit',
          depositType: 'PERCENTAGE',
          depositValue: 50,
          layawayInstallments: 2,
          installmentFrequency: 'MONTHLY',
          minOrderSubtotal: 300,
          scope: 'COLLECTION',
          targetCollectionIds: ['custom-jewelry', 'bespoke-rings'],
          enabled: true,
          description: '50% deposit to start production; balance due in 2 monthly installments',
        }
      ];

      let storedRules = [...defaultRules];
      let storageChecks = 0;

      export const assessConfigurationStorage = async () => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('storage') === 'fail') {
          storageChecks += 1;
          // Fail long enough that first-load auto-retry (checks 1-4 over ~30s)
          // exhausts and the provisioning loader takes over; the loader's own
          // 15s poll then succeeds on check 5.
          if (storageChecks <= 4) {
            return {
              ready: false,
              state: 'provisioning',
              message: 'DepositCraft is still provisioning private storage after install or update. This usually finishes within 10–15 minutes — click Check again or keep this page open.',
            };
          }
        }
        return { ready: true, state: 'ready', message: '' };
      };

      export const verifyConfigurationStorage = async () => (await assessConfigurationStorage()).ready;

      export const loadConfiguration = async () => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('load') === 'failure') throw new Error('mock storage read failure');
        return [...storedRules];
      };

      export const saveConfiguration = async (entries) => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('save') === 'failure') throw new Error('mock storage save failure');
        storedRules = [...entries];
      };

      export const initializeConfiguration = async () => {
        storedRules = [...defaultRules];
      };
    `,
    'installment-billing': `
      // Seed enough ledger records to span 2+ pages of the dashboard's 25-item page size,
      // so the browser harness can exercise real cursor pagination ("Load more").
      const LEDGER_PAGE_SIZE = 25;
      const TOTAL_LEDGER_RECORDS = 30;
      const seedLedgers = Array.from({ length: TOTAL_LEDGER_RECORDS }, (_, i) => ({
        _id: 'order-' + String(i + 1).padStart(4, '0'),
        orderId: 'order-' + String(i + 1).padStart(4, '0'),
        ruleId: i % 2 === 0 ? 'luxury-furniture-layaway' : 'custom-jewelry-deposit',
        currency: 'USD',
        totalOrderAmount: 500 + i * 10,
        installments: [
          { installmentNumber: 1, amount: 125 + i, status: 'PAID' },
          { installmentNumber: 2, amount: 125 + i, status: i % 3 === 0 ? 'PAID' : 'PENDING' },
        ],
      }));

      export const listPaymentLedgerPage = async ({ cursor, pageSize } = {}) => {
        const size = pageSize || LEDGER_PAGE_SIZE;
        const start = cursor ? parseInt(cursor, 10) : 0;
        const end = start + size;
        const items = seedLedgers.slice(start, end);
        const hasNext = end < seedLedgers.length;
        return { items, nextCursor: hasNext ? String(end) : undefined, hasNext };
      };

      export const processDueInstallments = async () => ({ scanned: 0, linksCreated: 0, dueCount: 0 });
    `,
  };

  return {
    name: 'depositcraft-dashboard-wix-service-mocks',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '@wix/app-management') return virtual('app-management');
      if (source === '@wix/essentials') return virtual('essentials');
      if (!importer?.endsWith('/src/dashboard/pages/page.tsx')) return null;
      const mock = pageImports[source];
      return mock ? virtual(mock) : null;
    },
    load(id) {
      if (!id.startsWith('\0depositcraft-dashboard-test:')) return null;
      const mock = id.replace('\0depositcraft-dashboard-test:', '');
      return mocks[mock];
    },
  };
}

export default defineConfig({
  plugins: [wixServiceMocks()],
});
