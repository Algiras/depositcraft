import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyStorageFailure,
  confirmStorageWithAutoRetry,
  permissionMessage,
  storageAccessBlockedMessage,
  storageDetailHint,
  type StorageReadinessAssessment,
} from './storage-readiness';

it('classifies a bare 403 as permission_denied with actionable storage copy on a single probe', () => {
  // A single, unretried probe still reports the real permission_denied
  // state/copy -- classifyStorageFailure's raw semantics for one probe are
  // unchanged. Whether that single probe result is terminal (shown to the
  // merchant) or provisional (retried behind the Loader) is decided by
  // confirmStorageWithAutoRetry, not here -- see the describe block below.
  const readiness = classifyStorageFailure(new Error('403 Forbidden'), 'DepositCraft');
  expect(readiness.state).toBe('permission_denied');
  expect(readiness.message).toBe(storageAccessBlockedMessage('DepositCraft'));
  expect(permissionMessage('DepositCraft')).toContain('Complete Setup');
});

it('returns state-specific storage detail hints', () => {
  expect(storageDetailHint('provisioning')).toContain('Check again');
  expect(storageDetailHint('schema_mismatch')).toContain('latest storage schema');
  expect(storageDetailHint('error', '1789305782.3301491106511416')).toContain('1789305782.3301491106511416');
});

describe('confirmStorageWithAutoRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls on DepositCraft\'s product-tuned 5s/10s/15s cadence, not core\'s default', async () => {
    const provisioning: StorageReadinessAssessment = { ready: false, state: 'provisioning', message: '' };
    const ready: StorageReadinessAssessment = { ready: true, state: 'ready', message: '' };
    const probe = vi.fn()
      .mockResolvedValueOnce(provisioning)
      .mockResolvedValueOnce(provisioning)
      .mockResolvedValueOnce(provisioning)
      .mockResolvedValueOnce(ready);

    const resultPromise = confirmStorageWithAutoRetry(probe);

    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10000);
    expect(probe).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(15000);
    expect(probe).toHaveBeenCalledTimes(4);

    expect(await resultPromise).toBe(ready);
  });

  it('keeps a merchant on the self-recovering path while a 403 is still within the retry budget', async () => {
    const blocked: StorageReadinessAssessment = { ready: false, state: 'permission_denied', message: storageAccessBlockedMessage('DepositCraft') };
    const ready: StorageReadinessAssessment = { ready: true, state: 'ready', message: '' };
    const probe = vi.fn()
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(ready);

    const resultPromise = confirmStorageWithAutoRetry(probe);
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(2);

    const result = await resultPromise;
    expect(result).toBe(ready);
    expect(result.state).not.toBe('permission_denied');
  });

  it('escalates a 403 to terminal permission_denied only after the 5s/10s/15s budget is exhausted', async () => {
    const blocked: StorageReadinessAssessment = { ready: false, state: 'permission_denied', message: storageAccessBlockedMessage('DepositCraft') };
    const probe = vi.fn().mockResolvedValue(blocked);

    const resultPromise = confirmStorageWithAutoRetry(probe);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(15000);

    const result = await resultPromise;
    expect(result.state).toBe('permission_denied');
    expect(result.message).toBe(storageAccessBlockedMessage('DepositCraft'));
    expect(probe).toHaveBeenCalledTimes(4);
  });
});
