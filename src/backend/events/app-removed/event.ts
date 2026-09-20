import { appInstances } from '@wix/app-management';
import { createLifecycleEventHandlers } from '@wix-extensions/core/telemetry';

/**
 * Uninstall lifecycle telemetry: records churn; no merchant data is stored.
 */
export default appInstances.onAppInstanceRemoved(createLifecycleEventHandlers('depositcraft').onAppRemoved);
