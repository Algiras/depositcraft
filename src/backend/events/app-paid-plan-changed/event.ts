import { appInstances } from '@wix/app-management';
import { emitDiagnostic } from '../../../shared/logger';

/**
 * Monetization lifecycle telemetry: records free/pro plan transitions to
 * measure upgrade and downgrade flows.
 */
export default appInstances.onAppInstancePaidPlanChanged(async () => {
  emitDiagnostic('app_paid_plan_changed', {
    outcome: 'success',
    surface: 'backend_event',
  });
});
