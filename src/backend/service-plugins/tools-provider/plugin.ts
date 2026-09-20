import { toolsProvider } from '@wix/app-tools/service-plugins';
import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { createItemsQueryReader } from '../../../shared/storage-shape';
import { canUsePaidFeatures, getAppEntitlement } from '../../../shared/entitlement';
import { loadConfiguration, verifyConfigurationStorage } from '../../../shared/configuration';

// This SPI runs server-side with no merchant session, so every call below
// must go through `auth.elevate` (entitlement lookup and Wix Data reads) or
// it fails with 403 Forbidden / "Missing authentication information".
toolsProvider.provideHandlers({
  runTool: async ({ request }) => {
    switch (request.methodName) {
      case 'get-entitlement': {
        const entitlement = await getAppEntitlement({ elevated: true });
        return { response: { status: entitlement.status, isPaid: canUsePaidFeatures(entitlement) } };
      }
      case 'verify-storage': {
        return { response: { ready: await verifyConfigurationStorage(createItemsQueryReader(auth.elevate(items.query))) } };
      }
      case 'describe-config': {
        if (!(await verifyConfigurationStorage(createItemsQueryReader(auth.elevate(items.query))))) return { response: { ready: false, count: 0 } };
        return { response: { ready: true, count: (await loadConfiguration(auth.elevate(items.query))).length } };
      }
      default:
        throw new Error(`Unknown tool: ${request.methodName}`);
    }
  },
});
