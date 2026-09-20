import { appInstances } from '@wix/app-management';
import { emitDiagnostic } from '../../../shared/logger';

/**
 * Install lifecycle telemetry: records when a site adds the app so adoption
 * funnels (install -> dashboard visit -> setup finished) can be measured.
 *
 * NOTE (2026-09-20 hotfix): an earlier v2.2.0 revision kicked off a retrying
 * storage verification here (4s+9s sleeps). Wix event invocations are billed
 * against a short wall-clock budget, and installs started returning
 * 500/time-out. Event handlers must return immediately; storage verification
 * stays dashboard-side (first-load auto-retry + provisioning loader poll).
 */
export default appInstances.onAppInstanceInstalled(async () => {
  emitDiagnostic('app_installed', {
    outcome: 'success',
    surface: 'backend_event',
  });
});
