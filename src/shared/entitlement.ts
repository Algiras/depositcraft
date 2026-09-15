import { appInstances, billing } from '@wix/app-management';

export type AppEntitlement = { status: 'paid' | 'free' | 'unavailable'; packageName?: string };

/** Wix's app instance is the source of truth for a site's installed plan. */
export async function getAppEntitlement(): Promise<AppEntitlement> {
  try {
    const { instance } = await appInstances.getAppInstance();
    if (!instance) return { status: 'unavailable' };
    if (instance.isFree === false) {
      return { status: 'paid', packageName: instance.billing?.packageName ?? undefined };
    }
    return { status: 'free' };
  } catch {
    // A paid-only feature must remain unavailable when Wix cannot confirm a plan.
    return { status: 'unavailable' };
  }
}

export const canUsePaidFeatures = (entitlement: AppEntitlement) => entitlement.status === 'paid';

/** Wix-hosted pricing pages are the supported upgrade path for recurring Freemium plans. */
export function getWixPricingPageUrl(appId: string, instanceId: string): string | undefined {
  const normalizedAppId = appId.trim();
  const normalizedInstanceId = instanceId.trim();
  if (!normalizedAppId || !normalizedInstanceId) return undefined;
  return `https://www.wix.com/apps/upgrade/${encodeURIComponent(normalizedAppId)}?appInstanceId=${encodeURIComponent(normalizedInstanceId)}`;
}

/**
 * Opens Wix-managed checkout only for an explicitly configured Developer Center
 * product ID. An app ID is never a valid substitute.
 */
export async function getWixCheckoutUrl(productId: string, successUrl?: string): Promise<string> {
  if (!productId.trim()) throw new Error('A Wix Billing product ID is required before opening checkout');
  const response = await billing.getUrl(productId, successUrl ? { successUrl } : undefined);
  if (!response.checkoutUrl) throw new Error('Wix Billing did not return a checkout URL');
  return response.checkoutUrl;
}
