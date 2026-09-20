import { appInstances } from '@wix/app-management';
import { createLifecycleEventHandlers } from '@wix-extensions/core/telemetry';

/**
 * Install lifecycle telemetry: records when a site adds the app so adoption
 * funnels (install -> dashboard visit -> setup finished) can be measured.
 *
 * NOTE (2026-09-20 hotfix): an earlier v2.2.0 revision kicked off a retrying
 * storage verification here (4s+9s sleeps). Wix event invocations are billed
 * against a short wall-clock budget, and installs started returning
 * 500/time-out. Event handlers must return immediately; storage verification
 * stays dashboard-side (first-load auto-retry + provisioning loader poll).
 * `createLifecycleEventHandlers` is called with no hooks so this keeps
 * returning immediately after emitting telemetry.
 */
export default appInstances.onAppInstanceInstalled(createLifecycleEventHandlers('depositcraft').onAppInstalled);
