import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { emitBackendDiagnostic as emitDiagnostic } from '../shared/logger';
import { assessStorageRequirements, createItemsQueryReader } from '../shared/storage-shape';
import type { StorageReadinessAssessment } from '../shared/storage-readiness';

/**
 * Elevated (app-identity) storage assessment for the same collections the
 * dashboard verifies with the merchant session. Runs in backend contexts:
 * install events, App Tools, health checks.
 *
 * ROOT CAUSE FIX: this used to probe with `collections.getDataCollection`,
 * which requires `SCOPE.DC-DATA.DATA-COLLECTIONS-MANAGE` -- a scope
 * DepositCraft (like every app in this portfolio) does not hold, so this
 * 403'd permanently. It now probes with `items.query(...).limit(1).find(...)`,
 * which only needs `SCOPE.DC-DATA.READ`. See
 * `packages/core/src/storage/probe.ts` for the full incident writeup.
 */
export async function assessStorageElevated(): Promise<StorageReadinessAssessment> {
  return assessStorageRequirements(
    createItemsQueryReader(auth.elevate(items.query)),
    'DepositCraft',
  );
}

/**
 * Early verification started right after install/reinstall, while Wix
 * propagates the Data Collections extension. Wix backend event handlers are
 * short-lived, so this loop is bounded to a ~15s budget (3 attempts) instead
 * of spanning the full propagation window; the dashboard loader plus its
 * first-load auto-retry cover the merchant-present window after that.
 */
export const INSTALL_VERIFY_DELAYS_MS: readonly number[] = [4_000, 9_000];

export async function runInstallStorageVerification(
  delays: readonly number[] = INSTALL_VERIFY_DELAYS_MS,
  assess: () => Promise<StorageReadinessAssessment> = assessStorageElevated,
): Promise<StorageReadinessAssessment> {
  const start = Date.now();
  let attempts = 0;
  let last: StorageReadinessAssessment = { ready: false, state: 'provisioning', message: '' };
  for (const delayMs of [0, ...delays]) {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    attempts += 1;
    last = await assess();
    if (last.ready) break;
  }
  emitDiagnostic('storage_install_verify', last.ready ? {
    outcome: 'success',
    surface: 'backend_event',
    attempts,
    durationMs: Date.now() - start,
  } : {
    outcome: 'failure',
    surface: 'backend_event',
    attempts,
    durationMs: Date.now() - start,
    errorCode: last.state.toUpperCase(),
    wixRequestId: last.requestId,
  });
  return last;
}
