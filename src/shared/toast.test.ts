import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@wix/dashboard', () => ({ dashboard: api }));

import { showAppToast } from './toast';

beforeEach(() => vi.resetAllMocks());

describe('showAppToast (depositcraft)', () => {
  it('forwards message and type to the dashboard host', () => {
    showAppToast('Plan saved', 'success');
    expect(api.showToast).toHaveBeenCalledWith({ message: 'Plan saved', type: 'success' });
  });

  it('defaults to a success toast', () => {
    showAppToast('Done');
    expect(api.showToast).toHaveBeenCalledWith({ message: 'Done', type: 'success' });
  });

  it('never throws when not running inside the Wix dashboard host', () => {
    api.showToast.mockImplementation(() => {
      throw new Error('not embedded in dashboard');
    });
    expect(() => showAppToast('Plan deleted', 'error')).not.toThrow();
  });
});
