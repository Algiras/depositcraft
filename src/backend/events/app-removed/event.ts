import { appInstances } from '@wix/app-management';
import { emitDiagnostic } from '../../../shared/logger';

/**
 * Uninstall lifecycle telemetry: records churn; no merchant data is stored.
 */
export default appInstances.onAppInstanceRemoved(async (event) => {
  emitDiagnostic('app_removed', {
    outcome: 'success',
    surface: 'backend_event',
  });
});
