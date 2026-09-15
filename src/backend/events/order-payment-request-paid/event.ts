import { orderPaymentRequests } from '@wix/ecom';
import { handleOrderPaymentRequestPaid } from '../../payment-request-lifecycle';
import { runInstallmentBilling } from '../../installment-scheduler';

orderPaymentRequests.onOrderPaymentRequestPaid(async event => {
  const request = event.data.orderPaymentRequest;
  await handleOrderPaymentRequestPaid(request?._id ?? '', request?.orderId);
  try {
    await runInstallmentBilling();
  } catch (error) {
    console.error('DepositCraft installment billing run failed', error);
  }
});
