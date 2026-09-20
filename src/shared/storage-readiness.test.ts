import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyStorageFailure,
  confirmStorageWithAutoRetry,
  permissionMessage,
  storageAccessBlockedMessage,
  storageDetailHint,
  type StorageReadinessAssessment,
} from './storage-readiness';

it('treats 403 as its own permission_denied state with actionable storage copy', () => {
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
});
