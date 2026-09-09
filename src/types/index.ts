export type DepositType = 'PERCENTAGE' | 'FIXED';
export type DepositRuleScope = 'ALL_PRODUCTS' | 'COLLECTION' | 'SPECIFIC_PRODUCTS';
export type InstallmentFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface DepositRule {
  id: string;
  name: string;
  depositType: DepositType;
  depositValue: number; // e.g., 25 for 25% or 50 for $50 fixed
  layawayInstallments: number; // e.g., 2, 3, 4 payments after deposit
  installmentFrequency?: InstallmentFrequency; // e.g., 'BIWEEKLY'
  minOrderSubtotal?: number; // Minimum order spend threshold to qualify
  scope: DepositRuleScope; // Targeting scope
  targetCollectionIds?: string[]; // Collection IDs to match
  targetProductIds?: string[]; // Specific Product IDs to match
  taxable?: boolean;
  enabled: boolean;
  priority?: number;
  description?: string;
  createdAt?: string;
}

export interface CatalogReference {
  catalogItemId?: string;
  appId?: string;
  options?: Record<string, any>;
}

export interface CheckoutLineItem {
  id?: string;
  catalogItemId?: string; // Catalog V1 format
  catalogReference?: CatalogReference; // Catalog V3 format
  productName?: string;
  quantity: number;
  price: string | number;
  collectionIds?: string[]; // Collections item belongs to
  categoryId?: string; // Alternative category representation
}

export interface InstallmentScheduleItem {
  installmentNumber: number;
  label: string;
  amount: number;
  dueDescription: string;
}

export interface LayawaySchedule {
  totalOrderAmount: number;
  depositDueNow: number;
  remainingBalance: number;
  installmentsCount: number;
  installmentAmount: number;
  frequency: InstallmentFrequency;
  schedule: InstallmentScheduleItem[];
}

export interface DepositEvaluationInput {
  currency: string;
  lineItems: CheckoutLineItem[];
  rules: DepositRule[];
  selectedRuleId?: string;
}

export interface DepositEvaluationResult {
  eligible: boolean;
  ruleId?: string;
  ruleName?: string;
  depositType?: DepositType;
  depositValue?: number;
  orderSubtotal: number;
  qualifyingSubtotal: number;
  depositDueNow: number;
  remainingBalance: number;
  layawaySchedule?: LayawaySchedule;
  breakdownReasons: string[];
}
