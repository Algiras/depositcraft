export type StorageSetupState =
  | 'ready'
  | 'provisioning'
  | 'cms_required'
  | 'permission'
  | 'schema_mismatch'
  | 'timeout'
  | 'error';

export type StorageCheckItem = {
  id: string;
  name: string;
  ready: boolean;
  status: 'ready' | 'missing' | 'schema_mismatch' | 'error';
  detail?: string;
  missingPermissions?: string[];
};

export type StorageReadinessAssessment = {
  ready: boolean;
  state: StorageSetupState;
  message: string;
  details?: string;
  requestId?: string;
  items?: StorageCheckItem[];
};

export function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function extractRequestId(error: unknown): string | undefined {
  const visited = new Set<unknown>();
  const inspect = (value: unknown, depth: number): string | undefined => {
    if (typeof value !== 'object' || value === null || depth > 3 || visited.has(value)) return undefined;
    visited.add(value);
    for (const key of ['requestId', 'requestID', 'request_id', 'x-request-id']) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    for (const key of ['cause', 'details', 'response', 'data', 'error']) {
      const nested = inspect((value as Record<string, unknown>)[key], depth + 1);
      if (nested) return nested;
    }
    return undefined;
  };
  const propertyValue = inspect(error, 0);
  if (propertyValue) return propertyValue;
  return errorDetail(error).match(/(?:request[ _-]?id|x-request-id)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)/i)?.[1];
}

export function isCollectionMissing(error: unknown): boolean {
  return /WDE0025|data collection (?:was )?not found|404|NOT_FOUND/i.test(errorDetail(error));
}

export function isPermissionDenied(error: unknown): boolean {
  return /\b(401|403|forbidden|unauthorized|permission denied)\b/i.test(errorDetail(error));
}

export function isCmsMissing(error: unknown): boolean {
  return /WDE0110|CMS.*not installed/i.test(errorDetail(error));
}

export function provisioningMessage(appName: string): string {
  return `${appName} is still provisioning private storage after install or update. This usually finishes within 10–15 minutes — click Check again or keep this page open.`;
}

/** 403/401 on app-private collections usually means storage is not provisioned yet, not a Manage Apps OAuth step. */
export function storageAccessBlockedMessage(appName: string): string {
  return `${appName} private storage is not available on this site yet. In Manage Apps, update ${appName} to the latest version, wait 10–15 minutes after install or update, then click Check again.`;
}

export function permissionMessage(appName: string): string {
  return storageAccessBlockedMessage(appName);
}

export function cmsRequiredMessage(): string {
  return 'Add Wix CMS to this site, update this app to the latest version, then click Retry.';
}

/** Poll while Wix is still propagating extension-backed collections after install/update. */
export async function confirmStorageWithAutoRetry<T extends { ready: boolean; state?: StorageSetupState }>(
  check: () => Promise<T>,
  options?: { retryDelaysMs?: readonly number[] },
): Promise<T> {
  const retryDelaysMs = options?.retryDelaysMs ?? [5000, 10000, 15000];
  let last = await check();
  for (const delayMs of retryDelaysMs) {
    if (last.ready || (last.state !== 'provisioning' && last.state !== 'timeout')) {
      return last;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
    last = await check();
  }
  return last;
}

export function classifyStorageFailure(error: unknown, appName: string): StorageReadinessAssessment {
  const details = errorDetail(error);
  const requestId = extractRequestId(error);
  if (isCmsMissing(error)) {
    return { ready: false, state: 'cms_required', message: cmsRequiredMessage(), details, requestId };
  }
  if (isCollectionMissing(error)) {
    return {
      ready: false,
      state: 'provisioning',
      message: provisioningMessage(appName),
      details,
      requestId,
    };
  }
  if (isPermissionDenied(error)) {
    return {
      ready: false,
      state: 'provisioning',
      message: storageAccessBlockedMessage(appName),
      details,
      requestId,
    };
  }
  return {
    ready: false,
    state: 'error',
    message: 'We could not confirm storage is set up. Keep this page open and try again, or contact support if this continues.',
    details,
    requestId,
  };
}

export async function withStorageTimeout<T>(operation: () => Promise<T>, timeoutMs = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('STORAGE_CHECK_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function appendRequestId(message: string, requestId?: string): string {
  return requestId ? `${message} (Wix request ID: ${requestId})` : message;
}

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
        return 'If Manage Apps shows pending permissions for DepositCraft, approve them, wait a few minutes, then click Retry.';
      default:
        return 'If this continues, contact support with your Wix request ID.';
    }
  })();
  return appendRequestId(hint, requestId);
}
