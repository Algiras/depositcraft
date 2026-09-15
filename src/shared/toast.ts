import { dashboard } from '@wix/dashboard';

export type ToastType = 'success' | 'error';

/**
 * Thin wrapper around dashboard.showToast that never throws: the dashboard host
 * SDK is only available when the page is actually embedded in the Wix dashboard,
 * so unit tests and any standalone browser harness must keep working when it is not.
 */
export function showAppToast(message: string, type: ToastType = 'success'): void {
  try {
    dashboard.showToast({ message, type });
  } catch {
    // Not running inside the Wix dashboard host (unit tests / browser harness) - ignore.
  }
}
