import { expect, it } from 'vitest';
import { classifyStorageFailure, permissionMessage, storageAccessBlockedMessage, storageDetailHint } from './storage-readiness';

it('treats 403 as provisioning with actionable storage copy', () => {
  const readiness = classifyStorageFailure(new Error('403 Forbidden'), 'DepositCraft');
  expect(readiness.state).toBe('provisioning');
  expect(readiness.message).toBe(storageAccessBlockedMessage('DepositCraft'));
  expect(permissionMessage('DepositCraft')).not.toContain('Complete Setup');
});

it('returns state-specific storage detail hints', () => {
  expect(storageDetailHint('provisioning')).toContain('Check again');
  expect(storageDetailHint('schema_mismatch')).toContain('latest storage schema');
  expect(storageDetailHint('error', '1789305782.3301491106511416')).toContain('1789305782.3301491106511416');
});
