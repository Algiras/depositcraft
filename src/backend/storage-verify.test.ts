import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitDiagnostic = vi.fn();
vi.mock('../shared/logger', () => ({
  emitBackendDiagnostic: (...args: unknown[]) => emitDiagnostic(...args),
}));

import { runInstallStorageVerification } from './storage-verify';
import type { StorageReadinessAssessment } from '../shared/storage-readiness';

const provisioning: StorageReadinessAssessment = { ready: false, state: 'provisioning', message: '' };
const ready: StorageReadinessAssessment = { ready: true, state: 'ready', message: '' };

describe('runInstallStorageVerification', () => {
  beforeEach(() => {
    emitDiagnostic.mockClear();
  });

  it('returns immediately when storage is already provisioned', async () => {
    const assess = vi.fn().mockResolvedValue(ready);
    const result = await runInstallStorageVerification([5, 5], assess);
    expect(result).toBe(ready);
    expect(assess).toHaveBeenCalledTimes(1);
    expect(emitDiagnostic).toHaveBeenCalledWith('storage_install_verify', expect.objectContaining({
      outcome: 'success',
      attempts: 1,
    }));
  });

  it('retries through the delay schedule and succeeds on a later attempt', async () => {
    const assess = vi.fn()
      .mockResolvedValueOnce(provisioning)
      .mockResolvedValueOnce({ ...provisioning, state: 'timeout' })
      .mockResolvedValueOnce(ready);
    const result = await runInstallStorageVerification([1, 1], assess);
    expect(result).toBe(ready);
    expect(assess).toHaveBeenCalledTimes(3);
    expect(emitDiagnostic).toHaveBeenCalledWith('storage_install_verify', expect.objectContaining({
      outcome: 'success',
      attempts: 3,
    }));
  });

  it('retries a first-attempt permission_denied (403) through the install-verify budget instead of treating it as final', async () => {
    const blocked: StorageReadinessAssessment = { ready: false, state: 'permission_denied', message: 'blocked' };
    const assess = vi.fn()
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(ready);
    const result = await runInstallStorageVerification([1, 1], assess);
    expect(result).toBe(ready);
    expect(assess).toHaveBeenCalledTimes(2);
  });

  it('stays bounded: one attempt per delay slot, failure telemetry carries the last state', async () => {
    const assess = vi.fn().mockResolvedValue({ ...provisioning, state: 'schema_mismatch', requestId: 'req-1' });
    const result = await runInstallStorageVerification([1, 1, 1], assess);
    expect(result.state).toBe('schema_mismatch');
    expect(assess).toHaveBeenCalledTimes(4);
    expect(emitDiagnostic).toHaveBeenCalledWith('storage_install_verify', expect.objectContaining({
      outcome: 'failure',
      errorCode: 'SCHEMA_MISMATCH',
      wixRequestId: 'req-1',
    }));
  });
});
