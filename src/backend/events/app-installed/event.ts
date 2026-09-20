import { appInstances } from '@wix/app-management';
import { emitDiagnostic } from '../../../shared/logger';
import { runInstallStorageVerification } from '../../storage-verify';

/**
 * Install lifecycle telemetry: records when a site adds the app so adoption
 * funnels (install -> dashboard visit -> setup finished) can be measured.
 * Also kicks off the bounded early storage verification so fast propagation
 * is confirmed server-side and slower cases surface in telemetry with a
 * request ID support can trace.
 */
export default appInstances.onAppInstanceInstalled(async () => {
  emitDiagnostic('app_installed', {
    outcome: 'success',
    surface: 'backend_event',
  });
  void runInstallStorageVerification().catch(() => undefined);
});
