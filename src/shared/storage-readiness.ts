import type { StorageState } from '@wix-extensions/core/storage';
import {
  appendRequestId as coreAppendRequestId,
  classifyStorageFailure as coreClassifyStorageFailure,
  cmsRequiredMessage as coreCmsRequiredMessage,
  confirmStorageWithAutoRetry as coreConfirmStorageWithAutoRetry,
  errorDetail as coreErrorDetail,
  extractRequestId as coreExtractRequestId,
  isCmsMissing as coreIsCmsMissing,
  isCollectionMissing as coreIsCollectionMissing,
  isPermissionDenied as coreIsPermissionDenied,
  provisioningMessage as coreProvisioningMessage,
  storageAccessBlockedMessage as coreStorageAccessBlockedMessage,
  withStorageTimeout as coreWithStorageTimeout,
} from '@wix-extensions/core/storage';

export type StorageSetupState = StorageState;

export type StorageCheckItem = {
  id: string;
  name: string;
  ready: boolean;
  status: 'ready' | 'missing' | 'schema_mismatch' | 'error';
  detail?: string;
  missingPermissions?: string[];
  /** See core's `StorageCheckItem.permissionsVerified`: false when a reader (e.g. the
   * items.query-based default probe) could not see permissions data to verify. */
  permissionsVerified?: boolean;
};

export type StorageReadinessAssessment = {
  ready: boolean;
  state: StorageSetupState;
  message: string;
  details?: string;
  requestId?: string;
  items?: StorageCheckItem[];
};

// Byte-for-byte identical to core's implementation.
export const errorDetail = coreErrorDetail;

// Core's `extractRequestId` now walks the same nested error properties
// (cause/details/response/data/error/applicationError) this app's local copy
// used to, plus a couple more (traceId, JSON-string-encoded ids) — a strict
// superset, so delegate directly.
export const extractRequestId = coreExtractRequestId;

// Core's matchers are now a superset of this app's former local patterns
// (e.g. `isCollectionMissing` also matches "collection does not exist",
// `isCmsMissing` also matches "cms app not installed"/"wix data app is
// missing"), so delegate directly instead of keeping a narrower local copy.
export const isCollectionMissing = coreIsCollectionMissing;
export const isPermissionDenied = coreIsPermissionDenied;
export const isCmsMissing = coreIsCmsMissing;

// Byte-for-byte identical to core's implementation.
export const provisioningMessage = coreProvisioningMessage;

// Core's copy differs from this app's former wording (both describe the same
// "storage access blocked" condition, phrased differently). Per the
// migration, core's copy wins; this is a user-visible message change for the
// permission_denied storage state — see PR description / task report.
export const storageAccessBlockedMessage = coreStorageAccessBlockedMessage;

export function permissionMessage(appName: string): string {
  return storageAccessBlockedMessage(appName);
}

// Byte-for-byte equivalent to core's implementation when called with no
// appName (core defaults the placeholder to 'this app', matching this app's
// former hardcoded string), so delegate directly.
export function cmsRequiredMessage(): string {
  return coreCmsRequiredMessage();
}

/** Poll while Wix is still propagating extension-backed collections after install/update. */
export function confirmStorageWithAutoRetry(
  probe: () => Promise<StorageReadinessAssessment>,
  options?: { retryDelaysMs?: readonly number[] },
): Promise<StorageReadinessAssessment> {
  // This app's product-tuned retry cadence (5s/10s/15s) is slower than core's
  // default (1s/2.5s/5s); pass it explicitly to preserve that behavior.
  return coreConfirmStorageWithAutoRetry(probe, { retryDelaysMs: options?.retryDelaysMs ?? [5000, 10000, 15000] });
}

// Core's `classifyStorageFailure` now checks CMS-missing first, then
// collection-missing, then permission-denied — the same order this app's
// local copy used — and returns the distinct `permission_denied` state (with
// `storageAccessBlockedMessage` copy) instead of folding it into
// `provisioning`. Delegate directly.
export const classifyStorageFailure = coreClassifyStorageFailure;

// Byte-for-byte identical to core's implementation (same default timeout and error message).
export const withStorageTimeout = coreWithStorageTimeout;

// Byte-for-byte identical to core's implementation.
export const appendRequestId = coreAppendRequestId;

export function storageDetailHint(state: StorageSetupState, requestId?: string): string {
  const hint = (() => {
    switch (state) {
      case 'provisioning':
      case 'timeout':
        return 'App storage is provisioned automatically after install or update. Waiting a few minutes and clicking Check again is usually enough.';
      case 'schema_mismatch':
        return 'Update the app in Manage Apps so Wix can sync the latest storage schema, then click Retry.';
      case 'cms_required':
        return 'Add Wix CMS from the App Market if your site does not have it, then update DepositCraft and click Retry.';
      case 'permission':
      case 'permission_denied':
        return 'If Manage Apps shows pending permissions for DepositCraft, approve them, wait a few minutes, then click Retry.';
      default:
        return 'If this continues, contact support with your Wix request ID.';
    }
  })();
  return appendRequestId(hint, requestId);
}
