import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  FileText,
  FileSpreadsheet,
  LayoutDashboard,
  Palette,
  Plus,
  RefreshCw,
  ShieldCheck,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Download,
  DollarSign,
  Receipt,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  DialogModal,
  DialogTrigger,
  Input,
  Label,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from './components/ui';
import {
  apiFetch,
  setActivePersonaId,
  type ClientDto,
  type DocumentDto,
  type PersonaUser,
  type TemplateDto,
} from './api';
import {
  calculateDocumentTotals,
  type LineItemCalculationInput,
} from '../lib/calculations';
import { SAMPLE_CSV_TEMPLATE, type CsvRowError } from '../lib/csv-parser';

interface DashboardData {
  kpis: {
    activeClients: number;
    totalInvoiced: number;
    totalCollected: number;
    totalOutstanding: number;
    overdueAmount: number;
    openPipelineValue: number;
    invoiceCount: number;
    estimateCount: number;
  };
  recentAudits: Array<{
    id: string;
    actorEmail: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string | number;
  }>;
}

export function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [personas, setPersonas] = useState<PersonaUser[]>([]);
  const [currentUser, setCurrentUser] = useState<PersonaUser | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [estimates, setEstimates] = useState<DocumentDto[]>([]);
  const [invoices, setInvoices] = useState<DocumentDto[]>([]);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerMsg, setBannerMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // New Client Modal State
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [newClient, setNewClient] = useState({
    code: 'CLI-NEXUS',
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    taxIdentifier: '',
    paymentTermsDays: 30,
    currency: 'USD',
    line1: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'US',
  });

  // New Document (Estimate / Invoice) Composer State
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docFormType, setDocFormType] = useState<'estimate' | 'invoice'>('invoice');
  const [docNumber, setDocNumber] = useState('INV-2026-0042');
  const [docClientId, setDocClientId] = useState('');
  const [docIssueDate, setDocIssueDate] = useState('2026-10-20');
  const [docDueDate, setDocDueDate] = useState('2026-11-19');
  const [docCurrency, setDocCurrency] = useState('USD');
  const [docDiscountType, setDocDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [docDiscountValue, setDocDiscountValue] = useState(0);
  const [docNotes, setDocNotes] = useState('');
  const [docItems, setDocItems] = useState<LineItemCalculationInput[]>([
    {
      name: 'Cloudflare Edge Consulting & D1 Optimization',
      description: 'Architecture & migration sprint',
      quantity: 10,
      unit: 'hrs',
      unitPrice: 175,
      discountType: 'percentage',
      discountValue: 0,
      taxName: 'Sales Tax',
      taxRate: 8.25,
      taxCompound: false,
      secondTaxRate: 0,
      secondTaxCompound: false,
    },
  ]);

  // CSV Import State
  const [csvText, setCsvText] = useState(SAMPLE_CSV_TEMPLATE);
  const [autoCreateClients, setAutoCreateClients] = useState(true);
  const [csvResult, setCsvResult] = useState<{
    dryRun: boolean;
    totalRows: number;
    validRowCount: number;
    importedCount?: number;
    readyDocumentCount?: number;
    r2BackupKey?: string | null;
    errors: CsvRowError[];
  } | null>(null);

  // Template Studio State
  const [editingTemplate, setEditingTemplate] = useState<TemplateDto | null>(null);

  const notify = (type: 'success' | 'error', text: string) => {
    setBannerMsg({ type, text });
    setTimeout(() => setBannerMsg(null), 5000);
  };

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, dashRes, cliRes, estRes, invRes, tplRes] = await Promise.all([
        apiFetch<{ user: PersonaUser | null; availablePersonas: PersonaUser[] }>('/api/auth/me'),
        apiFetch<DashboardData>('/api/dashboard'),
        apiFetch<{ clients: ClientDto[] }>('/api/clients'),
        apiFetch<{ estimates: DocumentDto[] }>('/api/estimates'),
        apiFetch<{ invoices: DocumentDto[] }>('/api/invoices'),
        apiFetch<{ templates: TemplateDto[] }>('/api/templates'),
      ]);

      setCurrentUser(meRes.user);
      setPersonas(meRes.availablePersonas || []);
      setDashboard(dashRes);
      setClients(cliRes.clients || []);
      setEstimates(estRes.estimates || []);
      setInvoices(invRes.invoices || []);
      setTemplates(tplRes.templates || []);
      if (cliRes.clients?.length && !docClientId) {
        setDocClientId(cliRes.clients[0].id);
      }
      if (tplRes.templates?.length && !editingTemplate) {
        setEditingTemplate(tplRes.templates[0]);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to load workspace data');
    } finally {
      setLoading(false);
    }
  }, [docClientId, editingTemplate]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handlePersonaSwitch = async (personaId: string) => {
    setActivePersonaId(personaId);
    await refreshAll();
    const target = personas.find((p) => p.id === personaId);
    if (target) {
      notify('success', `Switched RBAC session persona to ${target.name} (${target.role.toUpperCase()})`);
    }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          code: newClient.code,
          companyName: newClient.companyName,
          contactName: newClient.contactName,
          email: newClient.email,
          phone: newClient.phone,
          taxIdentifier: newClient.taxIdentifier,
          paymentTermsDays: Number(newClient.paymentTermsDays),
          currency: newClient.currency,
          billingAddress: {
            line1: newClient.line1,
            city: newClient.city,
            state: newClient.state,
            postalCode: newClient.postalCode,
            country: newClient.country,
          },
        }),
      });
      setClientModalOpen(false);
      notify('success', `Client "${newClient.companyName}" created.`);
      await refreshAll();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create client');
    }
  };

  const liveCalculation = calculateDocumentTotals(
    docItems,
    docDiscountType,
    docDiscountValue,
    0
  );

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const endpoint = docFormType === 'estimate' ? '/api/estimates' : '/api/invoices';
      await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          documentNumber: docNumber,
          clientId: docClientId,
          issueDate: docIssueDate,
          dueDate: docDueDate,
          currency: docCurrency,
          discountType: docDiscountType,
          discountValue: Number(docDiscountValue),
          notes: docNotes,
          items: docItems,
        }),
      });
      setDocModalOpen(false);
      notify(
        'success',
        `${docFormType === 'estimate' ? 'Estimate' : 'Invoice'} ${docNumber} created via atomic D1 batch.`
      );
      await refreshAll();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create document');
    }
  };

  const handleEstimateStatusChange = async (id: string, status: string) => {
    try {
      await apiFetch(`/api/estimates/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      notify('success', `Estimate transitioned to ${status.toUpperCase()}.`);
      await refreshAll();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Transition rejected');
    }
  };

  const handleConvertEstimate = async (id: string) => {
    try {
      const res = await apiFetch<{ invoice: DocumentDto }>(`/api/estimates/${id}/convert`, {
        method: 'POST',
      });
      notify(
        'success',
        `Estimate converted to Invoice ${res.invoice.documentNumber}!`
      );
      await refreshAll();
      setActiveTab('invoices');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Conversion failed');
    }
  };

  const handleInvoiceStatusChange = async (id: string, status: string) => {
    try {
      await apiFetch(`/api/invoices/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      notify('success', `Invoice transitioned to ${status.toUpperCase()}.`);
      await refreshAll();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Status update failed');
    }
  };

  const handleRecordPayment = async (inv: DocumentDto) => {
    const partialAmount = Math.round((inv.amountDue / 2) * 100) / 100;
    try {
      await apiFetch(`/api/invoices/${inv.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: partialAmount > 0 ? partialAmount : inv.total,
          reference: `ACH-${Date.now().toString().slice(-5)}`,
        }),
      });
      notify('success', `Recorded payment of ${inv.currency} ${partialAmount.toFixed(2)} for ${inv.documentNumber}`);
      await refreshAll();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Payment recording failed');
    }
  };

  const handleCsvRun = async (dryRun: boolean) => {
    try {
      const res = await apiFetch<{
        dryRun: boolean;
        totalRows: number;
        validRowCount: number;
        importedCount?: number;
        readyDocumentCount?: number;
        r2BackupKey?: string | null;
        errors: CsvRowError[];
      }>('/api/import/csv', {
        method: 'POST',
        body: JSON.stringify({
          csvText,
          dryRun,
          autoCreateMissingClients: autoCreateClients,
        }),
      });
      setCsvResult(res);
      if (dryRun) {
        notify(
          'success',
          `Dry-run validated ${res.validRowCount}/${res.totalRows} rows (${res.readyDocumentCount} documents ready).`
        );
      } else {
        notify(
          'success',
          `Atomically imported ${res.importedCount} documents to D1 & backed up CSV to R2.`
        );
        await refreshAll();
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'CSV import error');
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;
    try {
      await apiFetch(`/api/templates/${editingTemplate.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingTemplate),
      });
      notify('success', `Updated template "${editingTemplate.name}" (Admin RBAC verified).`);
      await refreshAll();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update template');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Edge Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center font-black text-white shadow-md shadow-blue-600/30">
              P
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-white">
                  PocketCRM
                </span>
                <span className="rounded-md bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                  Cloudflare Workers + D1 + R2
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Production CRM, Quoting & Invoicing Engine • Drizzle ORM & Better Auth RBAC
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* RBAC Role Switcher */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-slate-400">RBAC Session:</span>
              <select
                aria-label="RBAC Persona Switcher"
                value={currentUser?.id || 'usr_admin_01'}
                onChange={(e) => handlePersonaSwitch(e.target.value)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                    {p.name} [{p.role.toUpperCase()}]
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refreshAll()}
              title="Refresh D1 State"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync
            </Button>
          </div>
        </div>
      </header>

      {/* Notification Banner */}
      {bannerMsg && (
        <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-4">
          <div
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
              bannerMsg.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/60 text-emerald-200'
                : 'border-rose-500/40 bg-rose-950/60 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {bannerMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{bannerMsg.text}</span>
            </div>
            <button
              onClick={() => setBannerMsg(null)}
              className="text-xs underline opacity-75 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="mx-auto max-w-7xl w-full flex-1 px-4 sm:px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <TabsList>
              <TabsTrigger value="dashboard">
                <LayoutDashboard className="w-3.5 h-3.5" />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="clients">
                <Building2 className="w-3.5 h-3.5" />
                Clients ({clients.length})
              </TabsTrigger>
              <TabsTrigger value="estimates">
                <FileText className="w-3.5 h-3.5" />
                Estimates / Quotes ({estimates.length})
              </TabsTrigger>
              <TabsTrigger value="invoices">
                <Receipt className="w-3.5 h-3.5" />
                Invoices ({invoices.length})
              </TabsTrigger>
              <TabsTrigger value="import">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                CSV Ingestion Engine
              </TabsTrigger>
              <TabsTrigger value="templates">
                <Palette className="w-3.5 h-3.5" />
                Document Templates
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <Dialog open={clientModalOpen} onOpenChange={setClientModalOpen}>
                <DialogTrigger asChild>
                  <Button variant="secondary" size="sm">
                    <Plus className="w-3.5 h-3.5" />
                    New Client
                  </Button>
                </DialogTrigger>
                <DialogModal
                  title="Create CRM Client"
                  description="Add a client with billing address, tax identifier, and payment terms."
                >
                  <form onSubmit={handleCreateClient} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Client Code</Label>
                        <Input
                          value={newClient.code}
                          onChange={(e) =>
                            setNewClient({ ...newClient, code: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div>
                        <Label>Company Name</Label>
                        <Input
                          value={newClient.companyName}
                          onChange={(e) =>
                            setNewClient({ ...newClient, companyName: e.target.value })
                          }
                          placeholder="Stark Aerospace Inc."
                          required
                        />
                      </div>
                      <div>
                        <Label>Primary Contact</Label>
                        <Input
                          value={newClient.contactName}
                          onChange={(e) =>
                            setNewClient({ ...newClient, contactName: e.target.value })
                          }
                          placeholder="Pepper Potts"
                          required
                        />
                      </div>
                      <div>
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={newClient.email}
                          onChange={(e) =>
                            setNewClient({ ...newClient, email: e.target.value })
                          }
                          placeholder="ap@stark.io"
                          required
                        />
                      </div>
                      <div>
                        <Label>Tax Identifier (VAT / EIN)</Label>
                        <Input
                          value={newClient.taxIdentifier}
                          onChange={(e) =>
                            setNewClient({ ...newClient, taxIdentifier: e.target.value })
                          }
                          placeholder="US-EIN-88-1029384"
                        />
                      </div>
                      <div>
                        <Label>Payment Terms (Days)</Label>
                        <Input
                          type="number"
                          value={newClient.paymentTermsDays}
                          onChange={(e) =>
                            setNewClient({
                              ...newClient,
                              paymentTermsDays: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
                      <div className="col-span-2">
                        <Label>Billing Street Address</Label>
                        <Input
                          value={newClient.line1}
                          onChange={(e) =>
                            setNewClient({ ...newClient, line1: e.target.value })
                          }
                          placeholder="200 Park Avenue"
                          required
                        />
                      </div>
                      <div>
                        <Label>City</Label>
                        <Input
                          value={newClient.city}
                          onChange={(e) =>
                            setNewClient({ ...newClient, city: e.target.value })
                          }
                          placeholder="New York"
                          required
                        />
                      </div>
                      <div>
                        <Label>State / Postal Code</Label>
                        <div className="flex gap-2">
                          <Input
                            value={newClient.state}
                            onChange={(e) =>
                              setNewClient({ ...newClient, state: e.target.value })
                            }
                            placeholder="NY"
                          />
                          <Input
                            value={newClient.postalCode}
                            onChange={(e) =>
                              setNewClient({ ...newClient, postalCode: e.target.value })
                            }
                            placeholder="10166"
                            required
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-3">
                      <Button type="submit" variant="primary">
                        Save Client to D1
                      </Button>
                    </div>
                  </form>
                </DialogModal>
              </Dialog>

              <Dialog open={docModalOpen} onOpenChange={setDocModalOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      const nextPrefix = docFormType === 'estimate' ? 'EST' : 'INV';
                      setDocNumber(
                        `${nextPrefix}-2026-${Math.floor(1000 + Math.random() * 9000)}`
                      );
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Quote / Invoice
                  </Button>
                </DialogTrigger>
                <DialogModal
                  title="Create Quote or Invoice"
                  description="Atomic D1 batch parent-child insert with compound/simple tax & discount calculation."
                  className="max-w-4xl"
                >
                  <form onSubmit={handleCreateDocument} className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <Label>Document Type</Label>
                        <select
                          value={docFormType}
                          onChange={(e) => {
                            const t = e.target.value as 'estimate' | 'invoice';
                            setDocFormType(t);
                            setDocNumber(
                              `${t === 'estimate' ? 'EST' : 'INV'}-2026-${Math.floor(
                                1000 + Math.random() * 9000
                              )}`
                            );
                          }}
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                        >
                          <option value="invoice">Invoice</option>
                          <option value="estimate">Estimate / Quote</option>
                        </select>
                      </div>
                      <div>
                        <Label>Document Number</Label>
                        <Input
                          value={docNumber}
                          onChange={(e) => setDocNumber(e.target.value)}
                          required
                        />
                      </div>
                      <div className="col-span-2">
                        <Label>Client</Label>
                        <select
                          value={docClientId}
                          onChange={(e) => setDocClientId(e.target.value)}
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                          required
                        >
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.companyName} ({c.code})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label>Issue Date</Label>
                        <Input
                          type="date"
                          value={docIssueDate}
                          onChange={(e) => setDocIssueDate(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <Label>Due Date</Label>
                        <Input
                          type="date"
                          value={docDueDate}
                          onChange={(e) => setDocDueDate(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <Label>Doc Discount Type</Label>
                        <select
                          value={docDiscountType}
                          onChange={(e) =>
                            setDocDiscountType(e.target.value as 'percentage' | 'fixed')
                          }
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                        >
                          <option value="percentage">Percentage (%)</option>
                          <option value="fixed">Fixed Amount ($)</option>
                        </select>
                      </div>
                      <div>
                        <Label>Doc Discount Value</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={docDiscountValue}
                          onChange={(e) => setDocDiscountValue(Number(e.target.value))}
                        />
                      </div>
                    </div>

                    {/* Line Items Engine */}
                    <div className="border-t border-slate-800 pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="mb-0">
                          Line Items (Supports Simple & Compound Taxes)
                        </Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setDocItems([
                              ...docItems,
                              {
                                name: 'Additional Engineering Service',
                                description: '',
                                quantity: 1,
                                unit: 'hrs',
                                unitPrice: 150,
                                discountType: 'percentage',
                                discountValue: 0,
                                taxName: 'Tax',
                                taxRate: 8.25,
                                taxCompound: false,
                                secondTaxRate: 0,
                                secondTaxCompound: false,
                              },
                            ])
                          }
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Line Item
                        </Button>
                      </div>

                      <div className="space-y-2.5">
                        {docItems.map((item, idx) => (
                          <div
                            key={idx}
                            className="grid grid-cols-12 gap-2 items-center rounded-xl border border-slate-800/90 bg-slate-950/70 p-2.5"
                          >
                            <div className="col-span-4">
                              <Input
                                value={item.name}
                                onChange={(e) => {
                                  const next = [...docItems];
                                  next[idx] = { ...item, name: e.target.value };
                                  setDocItems(next);
                                }}
                                placeholder="Item name"
                                required
                              />
                            </div>
                            <div className="col-span-2">
                              <Input
                                type="number"
                                step="0.01"
                                value={item.quantity}
                                onChange={(e) => {
                                  const next = [...docItems];
                                  next[idx] = {
                                    ...item,
                                    quantity: Number(e.target.value),
                                  };
                                  setDocItems(next);
                                }}
                                placeholder="Qty"
                              />
                            </div>
                            <div className="col-span-2">
                              <Input
                                type="number"
                                step="0.01"
                                value={item.unitPrice}
                                onChange={(e) => {
                                  const next = [...docItems];
                                  next[idx] = {
                                    ...item,
                                    unitPrice: Number(e.target.value),
                                  };
                                  setDocItems(next);
                                }}
                                placeholder="Unit Price"
                              />
                            </div>
                            <div className="col-span-2">
                              <Input
                                type="number"
                                step="0.01"
                                value={item.taxRate}
                                onChange={(e) => {
                                  const next = [...docItems];
                                  next[idx] = {
                                    ...item,
                                    taxRate: Number(e.target.value),
                                  };
                                  setDocItems(next);
                                }}
                                placeholder="Tax %"
                              />
                            </div>
                            <div className="col-span-2 flex items-center justify-end gap-2">
                              <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.secondTaxCompound)}
                                  onChange={(e) => {
                                    const next = [...docItems];
                                    next[idx] = {
                                      ...item,
                                      secondTaxRate: e.target.checked ? 5 : 0,
                                      secondTaxCompound: e.target.checked,
                                    };
                                    setDocItems(next);
                                  }}
                                />
                                +5% Comp.
                              </label>
                              {docItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDocItems(docItems.filter((_, i) => i !== idx))
                                  }
                                  className="text-rose-400 hover:text-rose-300 p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Live Calculated Summary */}
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-950 p-4 border border-slate-800">
                      <div className="space-y-1 text-xs text-slate-400">
                        <div>
                          Subtotal:{' '}
                          <strong className="text-slate-200">
                            ${liveCalculation.subtotal.toFixed(2)}
                          </strong>
                        </div>
                        <div>
                          Discount Total:{' '}
                          <strong className="text-amber-400">
                            -${liveCalculation.discountTotal.toFixed(2)}
                          </strong>
                        </div>
                        <div>
                          Tax Total:{' '}
                          <strong className="text-sky-400">
                            +${liveCalculation.taxTotal.toFixed(2)}
                          </strong>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs uppercase tracking-wider text-slate-400">
                          Calculated Grand Total
                        </div>
                        <div className="text-2xl font-black text-white">
                          {docCurrency} ${liveCalculation.total.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button type="submit" variant="primary">
                        Commit Atomic Batch to D1
                      </Button>
                    </div>
                  </form>
                </DialogModal>
              </Dialog>
            </div>
          </div>

          {/* 1. DASHBOARD TAB */}
          <TabsContent value="dashboard" className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Total Invoiced Revenue
                </div>
                <div className="mt-2 text-2xl font-black text-white">
                  ${dashboard?.kpis.totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
                <div className="mt-1 text-xs text-emerald-400">
                  Collected: ${dashboard?.kpis.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
              </Card>

              <Card className="p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Outstanding Receivables
                </div>
                <div className="mt-2 text-2xl font-black text-amber-400">
                  ${dashboard?.kpis.totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
                <div className="mt-1 text-xs text-rose-400">
                  Overdue: ${dashboard?.kpis.overdueAmount.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
              </Card>

              <Card className="p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Estimates / Quote Pipeline
                </div>
                <div className="mt-2 text-2xl font-black text-sky-400">
                  ${dashboard?.kpis.openPipelineValue.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {dashboard?.kpis.estimateCount ?? 0} active quotes
                </div>
              </Card>

              <Card className="p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Active Enterprise Clients
                </div>
                <div className="mt-2 text-2xl font-black text-white">
                  {dashboard?.kpis.activeClients ?? 0}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Role: <strong className="text-blue-400 uppercase">{currentUser?.role ?? 'viewer'}</strong>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="p-5 lg:col-span-2">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                    Recent Invoices & Quotes
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                        <th className="py-2.5 px-3">Number</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3">Client</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {[...invoices, ...estimates].slice(0, 8).map((doc) => (
                        <tr key={doc.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-mono font-semibold text-blue-400">
                            {doc.documentNumber}
                          </td>
                          <td className="py-2.5 px-3 capitalize text-slate-300">
                            {doc.type}
                          </td>
                          <td className="py-2.5 px-3 text-slate-200">
                            {doc.client?.companyName || doc.clientId}
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge status={doc.status} />
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold">
                            {doc.currency} ${doc.total.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4">
                  Immutable Audit Trail (D1)
                </h2>
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {dashboard?.recentAudits.map((aud) => (
                    <div
                      key={aud.id}
                      className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between font-semibold text-blue-400">
                        <span>{aud.action}</span>
                        <span className="text-[10px] text-slate-500 uppercase">
                          {aud.entityType}
                        </span>
                      </div>
                      <div className="text-slate-400 mt-1 truncate">
                        Actor: {aud.actorEmail || 'system'} • ID: {aud.entityId}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* 2. CLIENTS TAB */}
          <TabsContent value="clients">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-white">
                    CRM Client Directory
                  </h2>
                  <p className="text-xs text-slate-400">
                    Manage customer contacts, billing addresses, tax IDs, and payment terms.
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                      <th className="py-3 px-3">Code</th>
                      <th className="py-3 px-3">Company</th>
                      <th className="py-3 px-3">Primary Contact</th>
                      <th className="py-3 px-3">Tax ID</th>
                      <th className="py-3 px-3">Terms</th>
                      <th className="py-3 px-3">Billing City</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {clients.map((cli) => (
                      <tr key={cli.id} className="hover:bg-slate-800/30">
                        <td className="py-3 px-3 font-mono text-xs font-bold text-blue-400">
                          {cli.code}
                        </td>
                        <td className="py-3 px-3 font-semibold text-white">
                          {cli.companyName}
                        </td>
                        <td className="py-3 px-3 text-slate-300">
                          <div>{cli.contactName}</div>
                          <div className="text-xs text-slate-500">{cli.email}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-slate-300">
                          {cli.taxIdentifier || '—'}
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-300">
                          Net {cli.paymentTermsDays}d ({cli.currency})
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-400">
                          {cli.billingAddress?.city}, {cli.billingAddress?.state}{' '}
                          {cli.billingAddress?.country}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* 3. ESTIMATES / QUOTES TAB */}
          <TabsContent value="estimates">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Estimates & Quotes Workflow
                  </h2>
                  <p className="text-xs text-slate-400">
                    State Transitions: Draft → Sent → Approved / Rejected → Converted to Invoice
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                      <th className="py-3 px-3">Estimate #</th>
                      <th className="py-3 px-3">Client</th>
                      <th className="py-3 px-3">Issue / Expiry</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Total</th>
                      <th className="py-3 px-3 text-right">Workflow Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {estimates.map((est) => (
                      <tr key={est.id} className="hover:bg-slate-800/30">
                        <td className="py-3 px-3 font-mono font-bold text-blue-400">
                          {est.documentNumber}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-white">
                            {est.client?.companyName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {est.client?.code}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-300">
                          {est.issueDate} → {est.dueDate}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={est.status} />
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-white">
                          {est.currency} ${est.total.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                            {est.status === 'draft' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  void handleEstimateStatusChange(est.id, 'sent')
                                }
                              >
                                Mark Sent
                              </Button>
                            )}
                            {est.status === 'sent' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="success"
                                  onClick={() =>
                                    void handleEstimateStatusChange(est.id, 'approved')
                                  }
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() =>
                                    void handleEstimateStatusChange(est.id, 'rejected')
                                  }
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                            {est.status === 'approved' && (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => void handleConvertEstimate(est.id)}
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                                Convert to Invoice
                              </Button>
                            )}
                            <a
                              href={`/api/estimates/${est.id}/pdf?format=html`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Preview
                            </a>
                            <a
                              href={`/api/estimates/${est.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-blue-400 hover:bg-slate-800"
                            >
                              <Download className="w-3 h-3" />
                              PDF (R2)
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* 4. INVOICES TAB */}
          <TabsContent value="invoices">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Invoices & Receivables Workflow
                  </h2>
                  <p className="text-xs text-slate-400">
                    State Transitions: Draft → Sent → Partial / Paid → Overdue → Cancelled
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                      <th className="py-3 px-3">Invoice #</th>
                      <th className="py-3 px-3">Client</th>
                      <th className="py-3 px-3">Due Date</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Total</th>
                      <th className="py-3 px-3 text-right">Balance Due</th>
                      <th className="py-3 px-3 text-right">Workflow Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-800/30">
                        <td className="py-3 px-3 font-mono font-bold text-blue-400">
                          {inv.documentNumber}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-white">
                            {inv.client?.companyName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {inv.client?.code}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-300">
                          {inv.dueDate}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-white">
                          {inv.currency} ${inv.total.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-amber-400">
                          {inv.currency} ${inv.amountDue.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                            {inv.status === 'draft' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  void handleInvoiceStatusChange(inv.id, 'sent')
                                }
                              >
                                Send Invoice
                              </Button>
                            )}
                            {['sent', 'partial', 'overdue'].includes(inv.status) && (
                              <>
                                <Button
                                  size="sm"
                                  variant="success"
                                  onClick={() => void handleRecordPayment(inv)}
                                >
                                  <DollarSign className="w-3 h-3" />
                                  Record Payment
                                </Button>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() =>
                                    void handleInvoiceStatusChange(inv.id, 'paid')
                                  }
                                >
                                  Mark Paid
                                </Button>
                              </>
                            )}
                            {inv.status === 'sent' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void handleInvoiceStatusChange(inv.id, 'overdue')
                                }
                              >
                                Mark Overdue
                              </Button>
                            )}
                            <a
                              href={`/api/invoices/${inv.id}/pdf?format=html`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Preview
                            </a>
                            <a
                              href={`/api/invoices/${inv.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-blue-400 hover:bg-slate-800"
                            >
                              <Download className="w-3 h-3" />
                              PDF (R2)
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* 5. CSV INGESTION ENGINE TAB */}
          <TabsContent value="import" className="space-y-6">
            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Templated CSV Ingestion Engine (PapaParse + Zod + Atomic D1 Batch)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Required Columns: Document Number, Client Identifier, Issue Date, Due Date, Status, Currency, Line Item Name, Line Item Description, Quantity, Unit Price, Tax Rate
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href="/api/import/template"
                    download="pocketcrm_documents_template.csv"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download CSV Schema Template
                  </a>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label>CSV Payload (Paste or Edit Below)</Label>
                  <textarea
                    rows={8}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCreateClients}
                      onChange={(e) => setAutoCreateClients(e.target.checked)}
                    />
                    Auto-create missing Client Identifiers during import
                  </label>

                  <div className="flex items-center gap-2.5">
                    <Button
                      variant="secondary"
                      onClick={() => void handleCsvRun(true)}
                    >
                      Validate Dry-Run (PapaParse + Zod)
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => void handleCsvRun(false)}
                    >
                      Execute Atomic D1 Batch Import + R2 Backup
                    </Button>
                  </div>
                </div>
              </div>

              {csvResult && (
                <div className="mt-6 border-t border-slate-800 pt-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-950 p-4 border border-slate-800">
                    <div className="flex items-center gap-6 text-xs">
                      <div>
                        Mode:{' '}
                        <strong className="text-blue-400 uppercase">
                          {csvResult.dryRun ? 'Dry-Run Validation' : 'Committed to D1'}
                        </strong>
                      </div>
                      <div>
                        Valid Rows:{' '}
                        <strong className="text-emerald-400">
                          {csvResult.validRowCount} / {csvResult.totalRows}
                        </strong>
                      </div>
                      {csvResult.r2BackupKey && (
                        <div>
                          R2 CSV Backup Key:{' '}
                          <code className="text-sky-400">{csvResult.r2BackupKey}</code>
                        </div>
                      )}
                    </div>
                  </div>

                  {csvResult.errors.length > 0 && (
                    <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-rose-300 mb-2">
                        Row-Level Validation Errors ({csvResult.errors.length})
                      </h3>
                      <div className="space-y-1.5 text-xs text-rose-200 font-mono">
                        {csvResult.errors.map((err, i) => (
                          <div key={i}>
                            [Row {err.rowNumber}] {err.documentNumber ? `(${err.documentNumber}) ` : ''}
                            Field &quot;{err.field}&quot;: {err.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* 6. CONFIGURABLE DOCUMENT TEMPLATES TAB */}
          <TabsContent value="templates">
            {editingTemplate && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="p-6">
                  <h2 className="text-base font-bold text-white mb-1">
                    Configurable Document Template Studio
                  </h2>
                  <p className="text-xs text-slate-400 mb-4">
                    Customize CSS variables, logo placement, payment instructions, and legal footer clauses. (Requires Admin RBAC role to save)
                  </p>

                  <form onSubmit={handleSaveTemplate} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Template Name</Label>
                        <Input
                          value={editingTemplate.name}
                          onChange={(e) =>
                            setEditingTemplate({
                              ...editingTemplate,
                              name: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label>Logo Placement</Label>
                        <select
                          value={editingTemplate.logoPlacement}
                          onChange={(e) =>
                            setEditingTemplate({
                              ...editingTemplate,
                              logoPlacement: e.target.value as 'left' | 'center' | 'right',
                            })
                          }
                          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                        >
                          <option value="left">Left Aligned</option>
                          <option value="center">Centered</option>
                          <option value="right">Right Aligned</option>
                        </select>
                      </div>
                      <div>
                        <Label>Primary Color (CSS Var)</Label>
                        <Input
                          type="color"
                          value={editingTemplate.styles.primaryColor}
                          onChange={(e) =>
                            setEditingTemplate({
                              ...editingTemplate,
                              styles: {
                                ...editingTemplate.styles,
                                primaryColor: e.target.value,
                              },
                            })
                          }
                          className="h-10 p-1"
                        />
                      </div>
                      <div>
                        <Label>Accent Color (CSS Var)</Label>
                        <Input
                          type="color"
                          value={editingTemplate.styles.accentColor}
                          onChange={(e) =>
                            setEditingTemplate({
                              ...editingTemplate,
                              styles: {
                                ...editingTemplate.styles,
                                accentColor: e.target.value,
                              },
                            })
                          }
                          className="h-10 p-1"
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Company Header Details</Label>
                      <textarea
                        rows={3}
                        value={editingTemplate.companyHeaderText}
                        onChange={(e) =>
                          setEditingTemplate({
                            ...editingTemplate,
                            companyHeaderText: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-xs text-white"
                      />
                    </div>

                    <div>
                      <Label>Payment Instructions</Label>
                      <textarea
                        rows={2}
                        value={editingTemplate.paymentInstructions}
                        onChange={(e) =>
                          setEditingTemplate({
                            ...editingTemplate,
                            paymentInstructions: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-xs text-white"
                      />
                    </div>

                    <div>
                      <Label>Footer Legal Clause</Label>
                      <textarea
                        rows={2}
                        value={editingTemplate.footerLegalClause}
                        onChange={(e) =>
                          setEditingTemplate({
                            ...editingTemplate,
                            footerLegalClause: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-xs text-white"
                      />
                    </div>

                    <div className="flex justify-end">
                      <Button type="submit" variant="primary">
                        Save Template Configuration
                      </Button>
                    </div>
                  </form>
                </Card>

                {/* Live Styled Preview */}
                <Card className="p-6 bg-white text-slate-900 overflow-hidden">
                  <div
                    style={{
                      borderBottom: `2px solid ${editingTemplate.styles.tableBorderColor}`,
                      background: editingTemplate.styles.headerBg,
                      padding: '20px',
                      borderRadius: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent:
                          editingTemplate.logoPlacement === 'center'
                            ? 'center'
                            : editingTemplate.logoPlacement === 'right'
                            ? 'flex-end'
                            : 'flex-start',
                        marginBottom: '12px',
                      }}
                    >
                      <span
                        style={{
                          background: editingTemplate.styles.accentColor,
                          color: '#fff',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          fontWeight: 800,
                          fontSize: '12px',
                        }}
                      >
                        POCKETCRM • LIVE TEMPLATE PREVIEW
                      </span>
                    </div>
                    <div className="flex justify-between items-start gap-4">
                      <div
                        className="text-xs whitespace-pre-line"
                        style={{ color: editingTemplate.styles.primaryColor }}
                      >
                        {editingTemplate.companyHeaderText}
                      </div>
                      <div className="text-right">
                        <div
                          className="text-lg font-black"
                          style={{ color: editingTemplate.styles.accentColor }}
                        >
                          INV-2026-0001
                        </div>
                        <div className="text-xs text-slate-500">Status: SENT</div>
                      </div>
                    </div>
                  </div>

                  <div className="py-6 space-y-4 text-xs">
                    <div className="border-b border-slate-200 pb-3">
                      <div className="font-bold text-slate-700">
                        Sample Line Item: Cloudflare Workers Edge Retainer
                      </div>
                      <div className="flex justify-between text-slate-500 mt-1">
                        <span>40 hrs × $150.00 (+8.25% Tax)</span>
                        <span className="font-bold text-slate-900">$6,470.25</span>
                      </div>
                    </div>

                    <div
                      className="rounded-lg p-3 space-y-2"
                      style={{ background: editingTemplate.styles.headerBg }}
                    >
                      <div>
                        <strong>Payment Instructions:</strong>
                        <div className="text-slate-600 mt-0.5">
                          {editingTemplate.paymentInstructions}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-500 border-t border-slate-200 pt-2">
                        {editingTemplate.footerLegalClause}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
