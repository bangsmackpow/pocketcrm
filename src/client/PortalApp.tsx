import React, { useEffect, useState } from 'react';
import {
  Download,
  CreditCard,
  CheckCircle2,
  Clock,
  Building2,
  Calendar,
  AlertCircle,
  FileCheck,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';

interface PortalDocument {
  id: string;
  documentNumber: string;
  type: 'invoice' | 'estimate';
  status: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  notes?: string;
  terms?: string;
  acceptedAt?: number;
  acceptedBySignature?: string;
  acceptedByEmail?: string;
  portalToken: string;
}

interface PortalClient {
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  billingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
}

interface PortalTemplate {
  companyHeaderText?: string;
  paymentInstructions?: string;
  footerLegalClause?: string;
  logoUrl?: string;
  logoR2Key?: string;
}

interface PortalLineItem {
  name: string;
  description?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
}

interface PortalPayment {
  id: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  createdAt: number;
}

interface PortalData {
  document: PortalDocument;
  client: PortalClient;
  template: PortalTemplate | null;
  items: PortalLineItem[];
  payments: PortalPayment[];
}

export function PortalApp({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [acceptModalOpen, setAcceptModalOpen] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [acceptSuccess, setAcceptSuccess] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const paymentStatus = urlParams.get('payment');

  const fetchDocument = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/portal/${token}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? 'Document not found or link has expired.' : 'Failed to load document.');
      }
      const json = (await res.json()) as PortalData;
      setData(json);
      if (json.client?.contactName) {
        setSignatureName(json.client.contactName);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading document');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocument();
  }, [token]);

  const handlePayNow = async () => {
    try {
      setPaying(true);
      const res = await fetch(`/api/portal/${token}/checkout`, {
        method: 'POST',
      });
      const json = (await res.json()) as { error?: string; checkoutUrl?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Failed to initialize payment checkout.');
      }
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
      }
    } catch (err: any) {
      alert(err.message || 'Payment initiation failed');
      setPaying(false);
    }
  };

  const handleAcceptEstimate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signatureName.trim()) return;

    try {
      setAccepting(true);
      const res = await fetch(`/api/portal/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signatureName: signatureName.trim(),
          email: data?.client?.email,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Failed to accept quote.');
      }
      setAcceptSuccess(true);
      setAcceptModalOpen(false);
      await fetchDocument();
    } catch (err: any) {
      alert(err.message || 'Could not accept quote');
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium text-slate-600">Loading document...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Unable to Load Document</h2>
          <p className="text-sm text-slate-600 mb-6">{error || 'This document link is invalid or has expired.'}</p>
          <p className="text-xs text-slate-400">Please contact the sender if you believe this is in error.</p>
        </div>
      </div>
    );
  }

  const { document: doc, client, template, items, payments: docPayments } = data;
  const isInvoice = doc.type === 'invoice';
  const isPaid = doc.status === 'paid' || doc.amountDue <= 0;
  const isAccepted = doc.status === 'accepted';
  const canAccept = !isInvoice && ['draft', 'sent'].includes(doc.status);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Payment Confirmation Banner */}
        {paymentStatus === 'success' && (
          <div className="mb-6 rounded-xl bg-emerald-50 border border-emerald-200 p-4 sm:p-5 flex items-start gap-4 shadow-sm animate-in fade-in duration-300">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-base font-semibold text-emerald-900">Payment Successfully Confirmed!</h3>
              <p className="text-sm text-emerald-700 mt-1">
                Thank you for your payment. Your transaction has been recorded, and an official receipt has been dispatched to your email.
              </p>
            </div>
          </div>
        )}

        {/* Acceptance Confirmation Banner */}
        {acceptSuccess && (
          <div className="mb-6 rounded-xl bg-emerald-50 border border-emerald-200 p-4 sm:p-5 flex items-start gap-4 shadow-sm animate-in fade-in duration-300">
            <FileCheck className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-base font-semibold text-emerald-900">Quote Accepted!</h3>
              <p className="text-sm text-emerald-700 mt-1">
                You have approved Quote #{doc.documentNumber}. An invoice has been automatically generated and the service team has been notified.
              </p>
            </div>
          </div>
        )}

        {/* Action Header Card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200/80 p-5 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900">
                  {isInvoice ? 'Invoice' : 'Estimate'} #{doc.documentNumber}
                </h1>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                    isPaid
                      ? 'bg-emerald-100 text-emerald-800'
                      : isAccepted
                      ? 'bg-emerald-100 text-emerald-800'
                      : doc.status === 'overdue'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {doc.status.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-slate-500">Issued to {client.companyName}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <a
              href={`/api/portal/${token}/pdf`}
              download={`${doc.documentNumber}.pdf`}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm w-full sm:w-auto transition-colors"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </a>

            {/* Pay Now Button */}
            {isInvoice && !isPaid && (
              <button
                onClick={handlePayNow}
                disabled={paying}
                className="inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50 w-full sm:w-auto transition-colors"
              >
                <CreditCard className="w-4 h-4" />
                {paying ? 'Connecting to Stripe...' : `Pay $${doc.amountDue.toFixed(2)}`}
              </button>
            )}

            {/* Accept Estimate Button */}
            {canAccept && (
              <button
                onClick={() => setAcceptModalOpen(true)}
                className="inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm w-full sm:w-auto transition-colors"
              >
                <FileCheck className="w-4 h-4" />
                Accept Quote
              </button>
            )}
          </div>
        </div>

        {/* Main Document Body */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 sm:p-10 mb-8">
          {/* Header & Company Brand */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6 pb-8 border-b border-slate-200">
            <div>
              {template?.logoUrl ? (
                <img src={template.logoUrl} alt="Company Logo" className="h-12 w-auto max-w-[200px] object-contain mb-3" />
              ) : (
                <div className="flex items-center gap-2 text-slate-900 font-bold text-xl mb-2">
                  <Building2 className="w-6 h-6 text-blue-600" />
                  <span>Built Networks</span>
                </div>
              )}
              <div className="text-xs text-slate-500 whitespace-pre-line leading-relaxed">
                {template?.companyHeaderText || 'Built Networks LLC\nAustin, TX'}
              </div>
            </div>

            <div className="sm:text-right">
              <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-1">
                {isInvoice ? 'Amount Due' : 'Estimated Total'}
              </div>
              <div className="text-3xl font-extrabold text-slate-900 mb-2">
                ${(isInvoice ? doc.amountDue : doc.total).toFixed(2)}{' '}
                <span className="text-sm font-normal text-slate-500">{doc.currency}</span>
              </div>
              <div className="space-y-1 text-xs text-slate-600">
                <div className="flex sm:justify-end gap-2">
                  <span className="text-slate-400">Issue Date:</span>
                  <span className="font-medium">{doc.issueDate}</span>
                </div>
                <div className="flex sm:justify-end gap-2">
                  <span className="text-slate-400">{isInvoice ? 'Due Date:' : 'Valid Until:'}</span>
                  <span className="font-medium">{doc.dueDate}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Billed To Box */}
          <div className="py-6 border-b border-slate-200">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Billed To</h3>
            <div className="text-base font-bold text-slate-900">{client.companyName}</div>
            <div className="text-sm text-slate-600 mt-0.5">Attn: {client.contactName} ({client.email})</div>
            {client.billingAddress?.line1 && (
              <div className="text-xs text-slate-500 mt-1">
                {[client.billingAddress.line1, client.billingAddress.city, client.billingAddress.state, client.billingAddress.postalCode, client.billingAddress.country]
                  .filter(Boolean)
                  .join(', ')}
              </div>
            )}
          </div>

          {/* Line Items Table */}
          <div className="py-6 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-2">Description</th>
                  <th className="py-3 px-2 text-center">Qty</th>
                  <th className="py-3 px-2 text-right">Price</th>
                  <th className="py-3 px-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="py-3.5 px-2">
                      <div className="font-semibold text-slate-900">{item.name}</div>
                      {item.description && (
                        <div className="text-xs text-slate-500 mt-0.5 whitespace-pre-line leading-relaxed">{item.description}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-2 text-center text-slate-600">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-3.5 px-2 text-right text-slate-600">${item.unitPrice.toFixed(2)}</td>
                    <td className="py-3.5 px-2 text-right font-medium text-slate-900">${item.lineTotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Summary */}
          <div className="pt-4 border-t border-slate-200 flex justify-end">
            <div className="w-full sm:w-72 space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>${doc.subtotal.toFixed(2)}</span>
              </div>
              {doc.discountTotal > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount</span>
                  <span>-${doc.discountTotal.toFixed(2)}</span>
                </div>
              )}
              {doc.taxTotal > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Tax</span>
                  <span>${doc.taxTotal.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
                <span>Total</span>
                <span>${doc.total.toFixed(2)}</span>
              </div>
              {isInvoice && (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>Amount Paid</span>
                    <span>-${doc.amountPaid.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-blue-600 pt-2 border-t border-slate-200">
                    <span>Balance Due</span>
                    <span>${doc.amountDue.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Notes & Remittance Instructions */}
          <div className="mt-8 pt-6 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-600">
            {doc.notes && (
              <div>
                <div className="font-semibold text-slate-900 mb-1">Notes:</div>
                <div className="whitespace-pre-line leading-relaxed">{doc.notes}</div>
              </div>
            )}
            {template?.paymentInstructions && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div className="font-semibold text-slate-900 mb-1">Payment Remittance:</div>
                <div className="whitespace-pre-line leading-relaxed">{template.paymentInstructions}</div>
              </div>
            )}
          </div>

          {/* Signature / Acceptance Badge if Accepted */}
          {doc.acceptedAt && (
            <div className="mt-8 p-4 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center gap-3 text-xs text-emerald-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <span className="font-semibold">Electronically Approved:</span> Signed by{' '}
                <strong>{doc.acceptedBySignature}</strong> ({doc.acceptedByEmail}) on{' '}
                {new Date(doc.acceptedAt).toLocaleDateString()}
              </div>
            </div>
          )}

          {/* Payment History if Any */}
          {docPayments.length > 0 && (
            <div className="mt-8 pt-6 border-t border-slate-200">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Payment Receipts</h4>
              <div className="space-y-2">
                {docPayments.map((pmt) => (
                  <div key={pmt.id} className="flex justify-between items-center text-xs p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="font-medium text-slate-900">
                        {pmt.paymentMethod === 'stripe_ach' ? 'Bank Transfer (ACH)' : 'Credit Card'}
                      </span>
                      <span className="text-slate-400">&bull;</span>
                      <span className="text-slate-500">{new Date(pmt.createdAt).toLocaleDateString()}</span>
                    </div>
                    <span className="font-semibold text-emerald-600">${pmt.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-slate-400 pb-12">
          {template?.footerLegalClause || 'Powered by PocketCRM & Built Networks LLC'}
        </div>
      </div>

      {/* Accept Estimate Modal */}
      {acceptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Accept Quote #{doc.documentNumber}</h3>
            <p className="text-sm text-slate-600 mb-5">
              By confirming, you agree to the estimate total of <strong>${doc.total.toFixed(2)} {doc.currency}</strong> and authorize commencement of work according to terms.
            </p>

            <form onSubmit={handleAcceptEstimate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Your Full Legal Name (Signature)
                </label>
                <input
                  type="text"
                  required
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setAcceptModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={accepting || !signatureName.trim()}
                  className="px-5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {accepting ? 'Signing...' : 'Confirm & Accept Quote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
