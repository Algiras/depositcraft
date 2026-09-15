import { orders } from '@wix/ecom';
import { reconcileCheckoutDepositOrder } from '../../checkout-order-lifecycle';

orders.onOrderCreated(async event => {
  const orderId = event.entity?._id;
  if (!orderId) return;
  try {
    await reconcileCheckoutDepositOrder(orderId);
  } catch (error) {
    console.error('DepositCraft checkout deposit reconciliation failed', error);
  }
});
