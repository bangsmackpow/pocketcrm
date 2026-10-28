import type {
  DiscountType,
  DocumentStatus,
  EstimateStatus,
  InvoiceStatus,
} from '../db/schema';

export interface LineItemCalculationInput {
  name: string;
  description?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  discountType?: DiscountType;
  discountValue?: number;
  taxName?: string;
  taxRate?: number;
  taxCompound?: boolean;
  secondTaxName?: string;
  secondTaxRate?: number;
  secondTaxCompound?: boolean;
}

export interface CalculatedLineItem extends LineItemCalculationInput {
  lineSubtotal: number;
  lineDiscountAmount: number;
  taxableAmount: number;
  lineTaxAmount: number;
  lineTotal: number;
}

export interface DocumentCalculationResult {
  items: CalculatedLineItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  amountDue: number;
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes line-level and document-level totals with support for:
 * - Unit prices & fractional quantities
 * - Line-level percentage or fixed discounts
 * - Document-level percentage or fixed discounts (pro-rated across taxable base)
 * - Granular simple and compound taxes (primary + secondary tax rates)
 */
export function calculateDocumentTotals(
  rawItems: LineItemCalculationInput[],
  docDiscountType: DiscountType = 'percentage',
  docDiscountValue = 0,
  amountPaid = 0
): DocumentCalculationResult {
  const preDocDiscountItems = rawItems.map((item) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const price = Math.max(0, Number(item.unitPrice) || 0);
    const rawSubtotal = roundCurrency(qty * price);

    const dType = item.discountType || 'percentage';
    const dVal = Math.max(0, Number(item.discountValue) || 0);
    const lineDiscount =
      dType === 'percentage'
        ? roundCurrency(rawSubtotal * (Math.min(dVal, 100) / 100))
        : roundCurrency(Math.min(dVal, rawSubtotal));

    const netAfterLineDiscount = roundCurrency(Math.max(0, rawSubtotal - lineDiscount));

    return {
      ...item,
      quantity: qty,
      unitPrice: price,
      discountType: dType,
      discountValue: dVal,
      taxRate: Math.max(0, Number(item.taxRate) || 0),
      taxCompound: Boolean(item.taxCompound),
      secondTaxRate: Math.max(0, Number(item.secondTaxRate) || 0),
      secondTaxCompound: Boolean(item.secondTaxCompound),
      lineSubtotal: rawSubtotal,
      lineDiscountAmount: lineDiscount,
      netAfterLineDiscount,
    };
  });

  const sumNetAfterLineDiscounts = roundCurrency(
    preDocDiscountItems.reduce((acc, i) => acc + i.netAfterLineDiscount, 0)
  );

  const rawSubtotalSum = roundCurrency(
    preDocDiscountItems.reduce((acc, i) => acc + i.lineSubtotal, 0)
  );

  const lineDiscountSum = roundCurrency(
    preDocDiscountItems.reduce((acc, i) => acc + i.lineDiscountAmount, 0)
  );

  const safeDocDiscountVal = Math.max(0, Number(docDiscountValue) || 0);
  const docLevelDiscount =
    docDiscountType === 'percentage'
      ? roundCurrency(sumNetAfterLineDiscounts * (Math.min(safeDocDiscountVal, 100) / 100))
      : roundCurrency(Math.min(safeDocDiscountVal, sumNetAfterLineDiscounts));

  const calculatedItems: CalculatedLineItem[] = preDocDiscountItems.map((item) => {
    // Pro-rate document-level discount across items proportionally for accurate compound/simple tax calculation
    const proportion =
      sumNetAfterLineDiscounts > 0
        ? item.netAfterLineDiscount / sumNetAfterLineDiscounts
        : 0;
    const allocatedDocDiscount = roundCurrency(docLevelDiscount * proportion);
    const taxableBase = roundCurrency(
      Math.max(0, item.netAfterLineDiscount - allocatedDocDiscount)
    );

    const primaryRate = item.taxRate ?? 0;
    const secondaryRate = item.secondTaxRate ?? 0;

    // Simple vs Compound tax calculation
    let primaryTax = roundCurrency(taxableBase * (primaryRate / 100));
    let secondaryTax = 0;

    if (secondaryRate > 0) {
      if (item.secondTaxCompound) {
        // Compound tax applies on top of (taxableBase + primaryTax)
        secondaryTax = roundCurrency((taxableBase + primaryTax) * (secondaryRate / 100));
      } else {
        secondaryTax = roundCurrency(taxableBase * (secondaryRate / 100));
      }
    }

    if (item.taxCompound && secondaryRate > 0 && !item.secondTaxCompound) {
      // If first tax is marked compound relative to second simple tax
      primaryTax = roundCurrency((taxableBase + secondaryTax) * (primaryRate / 100));
    }

    const lineTaxAmount = roundCurrency(primaryTax + secondaryTax);
    const lineTotal = roundCurrency(taxableBase + lineTaxAmount);

    return {
      name: item.name,
      description: item.description ?? '',
      quantity: item.quantity,
      unit: item.unit ?? 'hrs',
      unitPrice: item.unitPrice,
      discountType: item.discountType,
      discountValue: item.discountValue,
      taxName: item.taxName ?? 'Tax',
      taxRate: primaryRate,
      taxCompound: item.taxCompound,
      secondTaxName: item.secondTaxName,
      secondTaxRate: secondaryRate,
      secondTaxCompound: item.secondTaxCompound,
      lineSubtotal: item.lineSubtotal,
      lineDiscountAmount: item.lineDiscountAmount,
      taxableAmount: taxableBase,
      lineTaxAmount,
      lineTotal,
    };
  });

  const taxTotal = roundCurrency(
    calculatedItems.reduce((acc, i) => acc + i.lineTaxAmount, 0)
  );
  const discountTotal = roundCurrency(lineDiscountSum + docLevelDiscount);
  const total = roundCurrency(Math.max(0, rawSubtotalSum - discountTotal + taxTotal));
  const safePaid = roundCurrency(Math.max(0, Number(amountPaid) || 0));
  const amountDue = roundCurrency(Math.max(0, total - safePaid));

  return {
    items: calculatedItems,
    subtotal: rawSubtotalSum,
    discountTotal,
    taxTotal,
    total,
    amountPaid: safePaid,
    amountDue,
  };
}

// ============================================================================
// WORKFLOW STATE MACHINE VALIDATORS
// ============================================================================

const ESTIMATE_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ['sent', 'approved', 'accepted', 'rejected'],
  sent: ['approved', 'accepted', 'rejected', 'draft'],
  approved: ['converted', 'sent'],
  accepted: ['converted', 'sent'],
  rejected: ['draft', 'sent'],
  converted: [],
};

const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['partial', 'paid', 'overdue', 'cancelled'],
  partial: ['paid', 'overdue', 'cancelled'],
  overdue: ['partial', 'paid', 'cancelled'],
  paid: [],
  cancelled: ['draft'],
};

export function canTransitionEstimate(
  current: DocumentStatus,
  next: EstimateStatus
): boolean {
  if (current === next) return true;
  const allowed = ESTIMATE_TRANSITIONS[current as EstimateStatus];
  return Array.isArray(allowed) && allowed.includes(next);
}

export function canTransitionInvoice(
  current: DocumentStatus,
  next: InvoiceStatus
): boolean {
  if (current === next) return true;
  const allowed = INVOICE_TRANSITIONS[current as InvoiceStatus];
  return Array.isArray(allowed) && allowed.includes(next);
}
