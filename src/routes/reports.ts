import { Hono } from 'hono';
import { desc } from 'drizzle-orm';
import { requireRole, type AppEnv } from '../lib/auth';
import { clients, documents } from '../db/schema';
import { roundCurrency } from '../lib/calculations';

export const reportRoutes = new Hono<AppEnv>();

function isIowaState(state?: string | null): boolean {
  if (!state) return true; // Default local if unspecified
  const s = state.trim().toLowerCase();
  return s === 'ia' || s === 'iowa';
}

reportRoutes.get('/tax-summary', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const yearQuery = c.req.query('year') || 'all';
  const basis = (c.req.query('basis') || 'cash').toLowerCase();

  const [allClients, allDocs] = await Promise.all([
    db.select().from(clients),
    db.select().from(documents).orderBy(desc(documents.issueDate)),
  ]);

  const clientMap = new Map<string, typeof allClients[0]>();
  allClients.forEach((cl) => clientMap.set(cl.id, cl));

  // Filter only invoices (exclude estimates)
  const allInvoices = allDocs.filter((d) => d.type === 'invoice' && d.status !== 'cancelled');

  // Filter by year based on accounting method
  const filteredInvoices = allInvoices.filter((inv) => {
    if (yearQuery === 'all') return true;
    const dateToCheck = basis === 'cash' ? (inv.issueDate || '') : (inv.issueDate || '');
    return dateToCheck.startsWith(yearQuery);
  });

  let totalInvoiced = 0;
  let totalCollected = 0;
  let totalTaxCollected = 0;
  let totalOutstanding = 0;
  let inStateRevenue = 0;
  let outOfStateRevenue = 0;
  let taxableSales = 0;
  let exemptSales = 0;

  const quarters = [
    { quarter: 'Q1', label: 'Q1 (Jan 1 – Mar 31)', gross: 0, tax: 0, count: 0, iowaEstimatedVoucherDue: 'April 30' },
    { quarter: 'Q2', label: 'Q2 (Apr 1 – Jun 30)', gross: 0, tax: 0, count: 0, iowaEstimatedVoucherDue: 'July 1' },
    { quarter: 'Q3', label: 'Q3 (Jul 1 – Sep 30)', gross: 0, tax: 0, count: 0, iowaEstimatedVoucherDue: 'October 1' },
    { quarter: 'Q4', label: 'Q4 (Oct 1 – Dec 31)', gross: 0, tax: 0, count: 0, iowaEstimatedVoucherDue: 'January 31' },
  ];

  const clientStats = new Map<string, {
    id: string;
    code: string;
    companyName: string;
    contactName: string;
    state: string;
    isIowa: boolean;
    totalPaid: number;
    totalOutstanding: number;
    totalTax: number;
    invoiceCount: number;
  }>();

  // Initialize client stats
  allClients.forEach((cl) => {
    const isIA = isIowaState(cl.billingAddress?.state);
    clientStats.set(cl.id, {
      id: cl.id,
      code: cl.code,
      companyName: cl.companyName,
      contactName: cl.contactName,
      state: cl.billingAddress?.state || 'IA',
      isIowa: isIA,
      totalPaid: 0,
      totalOutstanding: 0,
      totalTax: 0,
      invoiceCount: 0,
    });
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const arAging = {
    current: { amount: 0, count: 0 },
    days1to30: { amount: 0, count: 0 },
    days31to60: { amount: 0, count: 0 },
    days61to90: { amount: 0, count: 0 },
    days90Plus: { amount: 0, count: 0 },
    invoices: [] as Array<{
      id: string;
      documentNumber: string;
      clientName: string;
      issueDate: string;
      dueDate: string;
      amountDue: number;
      daysPastDue: number;
      status: string;
    }>,
  };

  for (const inv of filteredInvoices) {
    const cl = clientMap.get(inv.clientId);
    const isIA = isIowaState(cl?.billingAddress?.state);
    const revenueAmount = basis === 'cash' ? (inv.status === 'paid' ? inv.total : inv.amountPaid) : inv.total;
    const taxAmount = basis === 'cash' ? (inv.status === 'paid' ? inv.taxTotal : (inv.amountPaid > 0 ? inv.taxTotal : 0)) : inv.taxTotal;

    totalInvoiced += inv.total;
    totalCollected += inv.amountPaid;
    totalOutstanding += inv.amountDue;
    totalTaxCollected += taxAmount;

    if (isIA) {
      inStateRevenue += revenueAmount;
    } else {
      outOfStateRevenue += revenueAmount;
    }

    if (inv.taxTotal > 0) {
      taxableSales += inv.subtotal;
    } else {
      exemptSales += inv.subtotal;
    }

    // Quarter calculation
    const month = new Date(inv.issueDate).getMonth(); // 0-11
    const qIndex = Math.floor(month / 3);
    if (qIndex >= 0 && qIndex <= 3) {
      quarters[qIndex].gross += revenueAmount;
      quarters[qIndex].tax += taxAmount;
      quarters[qIndex].count += 1;
    }

    // Client rollup
    const st = clientStats.get(inv.clientId);
    if (st) {
      st.totalPaid += inv.amountPaid;
      st.totalOutstanding += inv.amountDue;
      st.totalTax += inv.taxTotal;
      st.invoiceCount += 1;
    }

    // A/R Aging bucket
    if (inv.amountDue > 0 && inv.status !== 'draft') {
      const dueDate = new Date(inv.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const diffMs = today.getTime() - dueDate.getTime();
      const daysPastDue = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (daysPastDue <= 0) {
        arAging.current.amount += inv.amountDue;
        arAging.current.count += 1;
      } else if (daysPastDue <= 30) {
        arAging.days1to30.amount += inv.amountDue;
        arAging.days1to30.count += 1;
      } else if (daysPastDue <= 60) {
        arAging.days31to60.amount += inv.amountDue;
        arAging.days31to60.count += 1;
      } else if (daysPastDue <= 90) {
        arAging.days61to90.amount += inv.amountDue;
        arAging.days61to90.count += 1;
      } else {
        arAging.days90Plus.amount += inv.amountDue;
        arAging.days90Plus.count += 1;
      }

      arAging.invoices.push({
        id: inv.id,
        documentNumber: inv.documentNumber,
        clientName: cl?.companyName || 'Unknown Client',
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        amountDue: roundCurrency(inv.amountDue),
        daysPastDue: Math.max(0, daysPastDue),
        status: inv.status,
      });
    }
  }

  // Iowa Sales Tax Breakdown (Standard 6.00% State + 1.00% Local Option)
  // When 7% total is collected, 6/7 is State and 1/7 is LOST.
  const stateTaxCollected = roundCurrency((totalTaxCollected * 6) / 7);
  const localOptionTaxCollected = roundCurrency(totalTaxCollected - stateTaxCollected);

  const totalRevenue = inStateRevenue + outOfStateRevenue;
  const iowaApportionmentPercentage = totalRevenue > 0
    ? roundCurrency((inStateRevenue / totalRevenue) * 100)
    : 100;

  const sortedClients = Array.from(clientStats.values())
    .map((c) => ({
      ...c,
      totalPaid: roundCurrency(c.totalPaid),
      totalOutstanding: roundCurrency(c.totalOutstanding),
      totalTax: roundCurrency(c.totalTax),
    }))
    .sort((a, b) => b.totalPaid - a.totalPaid);

  return c.json({
    year: yearQuery,
    basis,
    summary: {
      totalInvoiced: roundCurrency(totalInvoiced),
      totalCollected: roundCurrency(totalCollected),
      totalOutstanding: roundCurrency(totalOutstanding),
      totalRevenue: roundCurrency(totalRevenue),
      inStateRevenue: roundCurrency(inStateRevenue),
      outOfStateRevenue: roundCurrency(outOfStateRevenue),
      iowaApportionmentPercentage,
      taxableSales: roundCurrency(taxableSales),
      exemptSales: roundCurrency(exemptSales),
      totalTaxCollected: roundCurrency(totalTaxCollected),
      stateTaxCollected,
      localOptionTaxCollected,
    },
    quarters: quarters.map((q) => ({
      ...q,
      gross: roundCurrency(q.gross),
      tax: roundCurrency(q.tax),
    })),
    arAging: {
      current: { amount: roundCurrency(arAging.current.amount), count: arAging.current.count },
      days1to30: { amount: roundCurrency(arAging.days1to30.amount), count: arAging.days1to30.count },
      days31to60: { amount: roundCurrency(arAging.days31to60.amount), count: arAging.days31to60.count },
      days61to90: { amount: roundCurrency(arAging.days61to90.amount), count: arAging.days61to90.count },
      days90Plus: { amount: roundCurrency(arAging.days90Plus.amount), count: arAging.days90Plus.count },
      invoices: arAging.invoices.sort((a, b) => b.daysPastDue - a.daysPastDue),
    },
    clients: sortedClients,
  });
});

reportRoutes.get('/tax-summary/export-csv', requireRole('viewer'), async (c) => {
  const db = c.get('db');
  const yearQuery = c.req.query('year') || 'all';
  const basis = (c.req.query('basis') || 'cash').toLowerCase();

  const [allClients, allDocs] = await Promise.all([
    db.select().from(clients),
    db.select().from(documents).orderBy(desc(documents.issueDate)),
  ]);

  const clientMap = new Map<string, typeof allClients[0]>();
  allClients.forEach((cl) => clientMap.set(cl.id, cl));

  const allInvoices = allDocs.filter((d) => d.type === 'invoice' && d.status !== 'cancelled');
  const filtered = allInvoices.filter((inv) => {
    if (yearQuery === 'all') return true;
    return inv.issueDate.startsWith(yearQuery);
  });

  const lines: string[] = [];
  lines.push(`PocketCRM Tax & Financial Summary`);
  lines.push(`Report Period: ${yearQuery.toUpperCase()}`);
  lines.push(`Accounting Method: ${basis.toUpperCase()} BASIS`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('--- INVOICE REGISTER & STATE APPORTIONMENT ---');
  lines.push('Invoice Number,Issue Date,Due Date,Client Code,Client Name,Client State,Status,Subtotal,Tax Total,Total,Amount Paid,Amount Due,Iowa In-State?');

  for (const inv of filtered) {
    const cl = clientMap.get(inv.clientId);
    const state = cl?.billingAddress?.state || 'IA';
    const isIA = isIowaState(state) ? 'YES (Iowa)' : 'NO (Out-of-State)';
    lines.push(
      [
        `"${inv.documentNumber}"`,
        `"${inv.issueDate}"`,
        `"${inv.dueDate}"`,
        `"${cl?.code || ''}"`,
        `"${(cl?.companyName || '').replace(/"/g, '""')}"`,
        `"${state}"`,
        `"${inv.status}"`,
        inv.subtotal.toFixed(2),
        inv.taxTotal.toFixed(2),
        inv.total.toFixed(2),
        inv.amountPaid.toFixed(2),
        inv.amountDue.toFixed(2),
        `"${isIA}"`,
      ].join(',')
    );
  }

  const csvContent = lines.join('\r\n');
  return new Response(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pocketcrm_tax_report_${yearQuery}_${basis}.csv"`,
    },
  });
});
