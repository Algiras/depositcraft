import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getAppInstance: vi.fn() }));
vi.mock('@wix/app-management', () => ({ appInstances: api }));

import { canUsePaidFeatures, getAppEntitlement, getWixPricingPageUrl } from './entitlement';

beforeEach(() => vi.resetAllMocks());

describe('Wix Billing entitlement (depositcraft)', () => {
  it('uses Wix app-instance state rather than a browser flag', async () => {
    api.getAppInstance.mockResolvedValue({ instance: { isFree: false, billing: { packageName: 'depositcraft-pro' } } });
    await expect(getAppEntitlement()).resolves.toEqual({ status: 'paid', packageName: 'depositcraft-pro' });
  });

  it('fails closed when Wix cannot confirm a paid plan', async () => {
    api.getAppInstance.mockRejectedValue(new Error('unavailable'));
    expect(canUsePaidFeatures(await getAppEntitlement())).toBe(false);
  });


  it('builds the Wix-hosted pricing-page URL from the app and site instance', () => {
    expect(getWixPricingPageUrl('depositcraft-app', 'site-instance')).toBe(
      'https://www.wix.com/apps/upgrade/depositcraft-app?appInstanceId=site-instance'
    );
    expect(getWixPricingPageUrl('depositcraft-app', '')).toBeUndefined();
  });
});
