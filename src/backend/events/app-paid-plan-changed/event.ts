import { appInstances } from '@wix/app-management';
import { createLifecycleEventHandlers } from '@wix-extensions/core/telemetry';

/**
 * Monetization lifecycle telemetry: records free/pro plan transitions to
 * measure upgrade and downgrade flows.
 */
export default appInstances.onAppInstancePaidPlanChanged(createLifecycleEventHandlers('depositcraft').onAppPaidPlanChanged);
