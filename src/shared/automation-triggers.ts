/** Dev Center automation trigger keys — must match automation-trigger.draft.json. */
export const INSTALLMENT_DUE_TRIGGER_KEY = 'installment_due_reminder';

export type InstallmentAutomationPayload = {
  contactId: string;
  orderId: string;
  installmentNumber: number;
  amount: number;
  currency: string;
  dueAt: string;
  paymentRequestUrl?: string;
  planName?: string;
};

export function installmentAutomationIdempotencyKey(orderId: string, installmentNumber: number): string {
  return `depositcraft:${orderId}:${installmentNumber}:due`;
}

function hashToUuidBytes(input: string): number[] {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const bytes = Array.from({ length: 16 }, (_, index) => (hash + Math.imul(index + 1, 0x9e3779b1)) & 0xff);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

/** Stable GUID external entity id for cancel/report pairing (required by Automations API). */
export function installmentAutomationExternalEntityId(orderId: string, installmentNumber: number): string {
  const hex = hashToUuidBytes(`${orderId}:${installmentNumber}:depositcraft-automation`)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
