import type { InstallmentFrequency } from '../types';

export function installmentDueAt(
  baseDate: Date,
  installmentNumber: number,
  frequency: InstallmentFrequency = 'BIWEEKLY',
): string | undefined {
  if (installmentNumber <= 0) return undefined;
  const due = new Date(baseDate);
  const weeks = frequency === 'WEEKLY' ? 1 : frequency === 'BIWEEKLY' ? 2 : 4;
  due.setUTCDate(due.getUTCDate() + installmentNumber * weeks * 7);
  return due.toISOString();
}
