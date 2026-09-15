import { toolsProvider } from '@wix/app-tools/service-plugins';
import { canUsePaidFeatures, getAppEntitlement } from '../../../shared/entitlement';
import { loadConfiguration, verifyConfigurationStorage } from '../../../shared/configuration';

toolsProvider.provideHandlers({
  runTool: async ({ request }) => {
    switch (request.methodName) {
      case 'get-entitlement': {
        const entitlement = await getAppEntitlement();
        return { response: { status: entitlement.status, isPaid: canUsePaidFeatures(entitlement) } };
      }
      case 'verify-storage': {
        return { response: { ready: await verifyConfigurationStorage() } };
      }
      case 'describe-config': {
        if (!(await verifyConfigurationStorage())) return { response: { ready: false, count: 0 } };
        return { response: { ready: true, count: (await loadConfiguration()).length } };
      }
      default:
        throw new Error(`Unknown tool: ${request.methodName}`);
    }
  },
});
