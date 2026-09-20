import { describe, it, expect } from 'vitest';
import {
  calculateSubtotal,
  getProductId,
  getItemCollections,
  filterQualifyingItems,
  buildLayawaySchedule,
  evaluateDepositPlan,
} from './deposit-engine';
import { DepositRule, CheckoutLineItem } from '../types';

describe('DepositCraft Engine Tests', () => {
  describe('calculateSubtotal', () => {
    it('returns 0 for empty items array', () => {
      expect(calculateSubtotal([])).toBe(0);
    });

    it('calculates subtotal with mixed Catalog V1 and V3 items, quantities, and string prices', () => {
      const items: CheckoutLineItem[] = [
        {
          catalogItemId: 'prod-v1',
          productName: 'Handcrafted Dining Table',
          quantity: 1,
          price: 750.0,
        },
        {
          catalogReference: { catalogItemId: 'prod-v3', appId: 'wix-stores' },
          productName: 'Leather Dining Chairs',
          quantity: 4,
          price: '125.50',
        },
        {
          id: 'prod-invalid',
          quantity: 2,
          price: 'invalid', // should be treated as 0
        },
      ];
      // 750 + (4 * 125.50) = 750 + 502 = 1252.00
      expect(calculateSubtotal(items)).toBe(1252.0);
    });
  });

  describe('getProductId & getItemCollections', () => {
    it('extracts product ID correctly for Catalog V1, V3, and fallback', () => {
      const v1Item: CheckoutLineItem = { catalogItemId: 'cat-123', quantity: 1, price: 100 };
      const v3Item: CheckoutLineItem = {
        catalogReference: { catalogItemId: 'cat-789', appId: 'wix-stores' },
        quantity: 1,
        price: 100,
      };
      const fallbackItem: CheckoutLineItem = { id: 'item-555', quantity: 1, price: 100 };

      expect(getProductId(v1Item)).toBe('cat-123');
      expect(getProductId(v3Item)).toBe('cat-789');
      expect(getProductId(fallbackItem)).toBe('item-555');
    });

    it('extracts collections from collectionIds, categoryId, and options', () => {
      const item: CheckoutLineItem = {
        catalogReference: {
          catalogItemId: 'p-1',
          options: { collectionId: 'col-opt' },
        },
        collectionIds: ['col-custom-furniture', 'col-luxury'],
        categoryId: 'col-living-room',
        quantity: 1,
        price: 300,
      };

      const cols = getItemCollections(item);
      expect(cols).toContain('col-custom-furniture');
      expect(cols).toContain('col-luxury');
      expect(cols).toContain('col-living-room');
      expect(cols).toContain('col-opt');
    });
  });

  describe('filterQualifyingItems', () => {
    const items: CheckoutLineItem[] = [
      {
        catalogItemId: 'custom-sofa',
        collectionIds: ['custom-orders', 'furniture'],
        quantity: 1,
        price: 1200,
      },
      {
        catalogItemId: 'throw-pillow',
        collectionIds: ['accessories'],
        quantity: 2,
        price: 45,
      },
    ];

    it('returns all items when rule scope is ALL_PRODUCTS', () => {
      const rule: DepositRule = {
        id: 'all-rule',
        name: 'All Products Deposit',
        depositType: 'PERCENTAGE',
        depositValue: 20,
        layawayInstallments: 3,
        scope: 'ALL_PRODUCTS',
        enabled: true,
      };
      expect(filterQualifyingItems(items, rule)).toHaveLength(2);
    });

    it('filters items matching targeted collection', () => {
      const rule: DepositRule = {
        id: 'col-rule',
        name: 'Custom Orders Only',
        depositType: 'PERCENTAGE',
        depositValue: 30,
        layawayInstallments: 4,
        scope: 'COLLECTION',
        targetCollectionIds: ['custom-orders'],
        enabled: true,
      };
      const filtered = filterQualifyingItems(items, rule);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].catalogItemId).toBe('custom-sofa');
    });

    it('filters items matching specific product IDs', () => {
      const rule: DepositRule = {
        id: 'prod-rule',
        name: 'Sofa Promo Deposit',
        depositType: 'FIXED',
        depositValue: 200,
        layawayInstallments: 2,
        scope: 'SPECIFIC_PRODUCTS',
        targetProductIds: ['throw-pillow'],
        enabled: true,
      };
      const filtered = filterQualifyingItems(items, rule);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].catalogItemId).toBe('throw-pillow');
    });
  });

  describe('buildLayawaySchedule', () => {
    it('creates accurate installment schedule with penny balancing on final installment', () => {
      // Total $1000, Deposit $250 -> Remaining $750 divided into 4 installments
      // 750 / 4 = 187.50 each
      const plan = buildLayawaySchedule(1000, 250, 4, 'BIWEEKLY');
      expect(plan.totalOrderAmount).toBe(1000);
      expect(plan.depositDueNow).toBe(250);
      expect(plan.remainingBalance).toBe(750);
      expect(plan.installmentsCount).toBe(4);
      expect(plan.schedule).toHaveLength(5); // Index 0 (deposit) + 4 installments

      const installmentsSum = plan.schedule.slice(1).reduce((acc, curr) => acc + curr.amount, 0);
      expect(Math.round(installmentsSum * 100) / 100).toBe(750);
    });

    it('adjusts rounding remainders correctly (e.g. 100 / 3)', () => {
      // Remaining $100 divided into 3 installments: 33.33 + 33.33 + 33.34 = 100.00
      const plan = buildLayawaySchedule(100, 0, 3, 'MONTHLY');
      expect(plan.schedule[1].amount).toBe(33.33);
      expect(plan.schedule[2].amount).toBe(33.33);
      expect(plan.schedule[3].amount).toBe(33.34);
      const total = plan.schedule[1].amount + plan.schedule[2].amount + plan.schedule[3].amount;
      expect(Math.round(total * 100) / 100).toBe(100);
    });
  });

  describe('evaluateDepositPlan', () => {
    const rules: DepositRule[] = [
      {
        id: 'luxury-layaway',
        name: 'Luxury Furniture Layaway',
        depositType: 'PERCENTAGE',
        depositValue: 25, // 25%
        layawayInstallments: 4,
        installmentFrequency: 'BIWEEKLY',
        minOrderSubtotal: 500,
        scope: 'ALL_PRODUCTS',
        enabled: true,
      },
      {
        id: 'fixed-deposit-plan',
        name: 'Custom Order $150 Flat Deposit',
        depositType: 'FIXED',
        depositValue: 150,
        layawayInstallments: 2,
        installmentFrequency: 'MONTHLY',
        scope: 'COLLECTION',
        targetCollectionIds: ['custom-made'],
        enabled: true,
      },
      {
        id: 'disabled-plan',
        name: 'Inactive Winter Plan',
        depositType: 'PERCENTAGE',
        depositValue: 10,
        layawayInstallments: 6,
        scope: 'ALL_PRODUCTS',
        enabled: false,
      },
    ];

    it('returns ineligible for empty or zero subtotal cart', () => {
      const res = evaluateDepositPlan({
        currency: 'USD',
        lineItems: [],
        rules,
      });
      expect(res.eligible).toBe(false);
      expect(res.orderSubtotal).toBe(0);
    });

    it('rejects order if subtotal is below minOrderSubtotal threshold', () => {
      const res = evaluateDepositPlan({
        currency: 'USD',
        lineItems: [{ catalogItemId: 'table-lamp', quantity: 1, price: 120 }], // $120 < $500
        rules,
        selectedRuleId: 'luxury-layaway',
      });
      expect(res.eligible).toBe(false);
      expect(res.ruleName).toBe('Luxury Furniture Layaway');
      expect(res.depositDueNow).toBe(120);
      expect(res.breakdownReasons[0]).toContain('below the required minimum threshold');
    });

    it('calculates 25% percentage deposit correctly when threshold is met', () => {
      const res = evaluateDepositPlan({
        currency: 'USD',
        lineItems: [{ catalogItemId: 'dining-set', quantity: 1, price: 1000 }],
        rules,
        selectedRuleId: 'luxury-layaway',
      });

      expect(res.eligible).toBe(true);
      expect(res.orderSubtotal).toBe(1000);
      expect(res.qualifyingSubtotal).toBe(1000);
      expect(res.depositDueNow).toBe(250); // 25% of 1000
      expect(res.remainingBalance).toBe(750);
      expect(res.layawaySchedule?.installmentsCount).toBe(4);
    });

    it('applies fixed deposit on targeted collection and charges non-qualifying items in full', () => {
      const res = evaluateDepositPlan({
        currency: 'USD',
        lineItems: [
          {
            catalogItemId: 'custom-desk',
            collectionIds: ['custom-made'],
            quantity: 1,
            price: 600,
          },
          {
            catalogItemId: 'desk-lamp',
            collectionIds: ['accessories'],
            quantity: 1,
            price: 80,
          },
        ],
        rules,
        selectedRuleId: 'fixed-deposit-plan',
      });

      expect(res.eligible).toBe(true);
      expect(res.orderSubtotal).toBe(680);
      expect(res.qualifyingSubtotal).toBe(600);
      // Fixed deposit $150 on custom-desk + full $80 on lamp = $230 due now
      expect(res.depositDueNow).toBe(230);
      expect(res.remainingBalance).toBe(450); // 680 - 230 = 450
      expect(res.layawaySchedule?.installmentsCount).toBe(2);
    });

    it('rejects if targeted collection has no matching items in cart', () => {
      const res = evaluateDepositPlan({
        currency: 'USD',
        lineItems: [
          {
            catalogItemId: 'standard-shelf',
            collectionIds: ['standard-furniture'],
            quantity: 1,
            price: 300,
          },
        ],
        rules,
        selectedRuleId: 'fixed-deposit-plan',
      });

      expect(res.eligible).toBe(false);
      expect(res.breakdownReasons[0]).toContain('None of the items in the cart qualify');
    });

    it('ignores disabled rules when auto-selecting rule', () => {
      const res = evaluateDepositPlan({
        currency: 'USD',
        lineItems: [{ catalogItemId: 'item-1', quantity: 1, price: 600 }],
        rules: [rules[2]], // Only disabled-plan provided
      });

      expect(res.eligible).toBe(false);
      expect(res.breakdownReasons[0]).toContain('No active deposit or layaway plans configured');
    });
  });
});
