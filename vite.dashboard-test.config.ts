import { defineConfig, type Plugin } from 'vite';

const virtual = (name: string) => `\0depositcraft-dashboard-test:${name}`;

function wixServiceMocks(): Plugin {
  const pageImports: Record<string, string> = {
    '../../shared/configuration': 'configuration',
    '../../shared/logger': 'logger',
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
      export class AppLogger {
        time(a, fn) { return fn(); }
        info() {}
        warn() {}
        error() {}
        trackUsage() {}
      }
      export const logger = new AppLogger('depositcraft');
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
          if (storageChecks === 1) {
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
  };

  return {
    name: 'depositcraft-dashboard-wix-service-mocks',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '@wix/app-management') return virtual('app-management');
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
