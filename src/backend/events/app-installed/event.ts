import { appInstances } from '@wix/app-management';
import { emitDiagnostic } from '../../../shared/logger';

/**
 * Install lifecycle telemetry: records when a site adds the app so adoption
 * funnels (install -> dashboard visit -> setup finished) can be measured.
 */
export default appInstances.onAppInstanceInstalled(async () => {
  emitDiagnostic('app_installed', {
    outcome: 'success',
    surface: 'backend_event',
  });
});
