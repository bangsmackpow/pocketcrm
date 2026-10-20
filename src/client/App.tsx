import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Building2,
  FileText,
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
  LogOut,
  Upload,
  User,
  KeyRound,
  FileSpreadsheet,
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
  signInEmail,
  signUpEmail,
  signOut,
  type AuthUser,
  type ClientDto,
  type DocumentDto,
  type TemplateDto,
} from './api';
import {
  calculateDocumentTotals,
  type LineItemCalculationInput,
} from '../lib/calculations';
import Papa from 'papaparse';

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
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [estimates, setEstimates] = useState<DocumentDto[]>([]);
  const [invoices, setInvoices] = useState<DocumentDto[]>([]);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Auth Form State (Sign In / Sign Up)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authRole, setAuthRole] = useState<'admin' | 'member' | 'viewer'>('admin');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

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

  // Client CSV Import Modal State
  const [clientImportModalOpen, setClientImportModalOpen] = useState(false);
  const [clientCsvText, setClientCsvText] = useState('');
  const [clientImporting, setClientImporting] = useState(false);
  const [clientImportErrors, setClientImportErrors] = useState<Array<{ rowNumber: number; field: string; message: string }>>([]);

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

  const itemCsvInputRef = useRef<HTMLInputElement>(null);
  const clientCsvInputRef = useRef<HTMLInputElement>(null);

  // Template Studio State
  const [editingTemplate, setEditingTemplate] = useState<TemplateDto | null>(null);

  const notify = (type: 'success' | 'error', text: string) => {
    setBannerMsg({ type, text });
    setTimeout(() => setBannerMsg(null), 5000);
  };

  const checkAuth = useCallback(async () => {
    try {
      const res = await apiFetch<{ user: AuthUser | null }>('/api/auth/me');
      setCurrentUser(res.user);
      return res.user;
    } catch {
      setCurrentUser(null);
      return null;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [dashRes, cliRes, estRes, invRes, tplRes] = await Promise.all([
        apiFetch<DashboardData>('/api/dashboard'),
        apiFetch<{ clients: ClientDto[] }>('/api/clients'),
        apiFetch<{ estimates: DocumentDto[] }>('/api/estimates'),
        apiFetch<{ invoices: DocumentDto[] }>('/api/invoices'),
        apiFetch<{ templates: TemplateDto[] }>('/api/templates'),
      ]);

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
  }, [currentUser, docClientId, editingTemplate]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (currentUser) {
      void refreshWorkspace();
    }
  }, [currentUser, refreshWorkspace]);

  // Auth Handlers
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);

    try {
      if (authMode === 'signin') {
        await signInEmail(authEmail, authPassword);
      } else {
        await signUpEmail(authName, authEmail, authPassword, authRole);
      }
      const user = await checkAuth();
      if (user) {
        notify('success', `Welcome back, ${user.name}! Authenticated as ${user.role.toUpperCase()}.`);
      } else {
        // Fallback check
        const me = await apiFetch<{ user: AuthUser | null }>('/api/auth/me');
        setCurrentUser(me.user);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setCurrentUser(null);
      notify('success', 'Signed out successfully.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Sign out failed');
    }
  };

  // Client Creation
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
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create client');
    }
  };

  // Client CSV Import
  const handleClientCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setClientCsvText(text);
      setClientImportErrors([]);
    };
    reader.readAsText(file);
  };

  const handleRunClientCsvImport = async () => {
    if (!clientCsvText.trim()) {
      notify('error', 'Please select or paste a client CSV first.');
      return;
    }
    setClientImporting(true);
    setClientImportErrors([]);
    try {
      const res = await apiFetch<{ importedCount: number; errors: Array<{ rowNumber: number; field: string; message: string }> }>(
        '/api/clients/import-csv',
        {
          method: 'POST',
          body: JSON.stringify({ csvText: clientCsvText }),
        }
      );
      if (res.errors?.length > 0) {
        setClientImportErrors(res.errors);
      }
      notify('success', `Successfully imported ${res.importedCount} clients into D1.`);
      if (res.errors?.length === 0) {
        setClientImportModalOpen(false);
        setClientCsvText('');
      }
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Client CSV import failed');
    } finally {
      setClientImporting(false);
    }
  };

  // Line Items CSV Import Inside Document Composer
  const handleItemCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = (evt.target?.result as string) || '';
      const parsed = Papa.parse<Record<string, unknown>>(text.trim(), {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.trim().toLowerCase(),
      });

      const getVal = (row: Record<string, unknown>, ...keys: string[]) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== '') return row[k];
        }
        return undefined;
      };

      const importedItems: LineItemCalculationInput[] = [];

      for (const row of parsed.data) {
        const name = (getVal(row, 'item name', 'name', 'line item name', 'item') as string) || '';
        if (!name) continue;

        const description = (getVal(row, 'description', 'desc', 'line item description') as string) || '';
        const quantity = Math.max(0.01, Number(getVal(row, 'quantity', 'qty')) || 1);
        const unit = (getVal(row, 'unit') as string) || 'hrs';
        const unitPrice = Math.max(0, Number(getVal(row, 'unit price', 'unit_price', 'price')) || 0);
        const taxRate = Math.max(0, Number(getVal(row, 'tax rate', 'tax_rate', 'tax')) || 0);
        const taxCompound = Boolean(getVal(row, 'compound tax', 'tax_compound', 'compound'));
        const discountValue = Math.max(0, Number(getVal(row, 'discount value', 'discount_value', 'discount')) || 0);

        importedItems.push({
          name,
          description,
          quantity,
          unit,
          unitPrice,
          discountType: 'percentage',
          discountValue,
          taxName: 'Tax',
          taxRate,
          taxCompound,
          secondTaxRate: 0,
          secondTaxCompound: false,
        });

        // Optional document header detection if present in first row
        const docNum = getVal(row, 'document number', 'document_number');
        if (docNum && typeof docNum === 'string') setDocNumber(docNum);
        const issue = getVal(row, 'issue date', 'issue_date');
        if (issue && typeof issue === 'string') setDocIssueDate(issue);
        const due = getVal(row, 'due date', 'due_date');
        if (due && typeof due === 'string') setDocDueDate(due);
        const curr = getVal(row, 'currency');
        if (curr && typeof curr === 'string') setDocCurrency(curr.toUpperCase());
      }

      if (importedItems.length > 0) {
        setDocItems(importedItems);
        notify('success', `Imported ${importedItems.length} line items from CSV.`);
      } else {
        notify('error', 'No valid line item rows detected in CSV.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const downloadItemsTemplate = () => {
    const csvContent =
      'Item Name,Description,Quantity,Unit,Unit Price,Tax Rate,Compound Tax\n' +
      'Cloudflare Workers Edge Engineering,Dedicated D1 + R2 infrastructure,40,hrs,150.00,8.25,false\n' +
      'Zero-Trust Security Audit,Penetration testing & endpoint hardening,10,hrs,200.00,8.25,false';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'pocketcrm_items_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadClientsTemplate = () => {
    const csvContent =
      'Company Name,Client Code,Contact Name,Email,Phone,Tax Identifier,Payment Terms (Days),Currency,Address Line 1,City,State,Postal Code,Country,Notes\n' +
      'Stark Industries,CLI-STARK,Tony Stark,ap@stark.io,+1 (212) 555-0100,US-EIN-12-3456789,30,USD,10880 Malibu Point,Malibu,CA,90265,US,Enterprise tier partner\n' +
      'Wayne Enterprises,CLI-WAYNE,Bruce Wayne,finance@wayne.com,+1 (212) 555-0199,US-EIN-98-7654321,15,USD,1007 Mountain Drive,Gotham,NJ,07001,US,Preferred Net 15 terms';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'pocketcrm_clients_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      await refreshWorkspace();
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
      await refreshWorkspace();
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
      await refreshWorkspace();
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
      await refreshWorkspace();
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
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Payment recording failed');
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
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update template');
    }
  };

  // 1. Loading State
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
          <span>Connecting to PocketCRM Secure Edge...</span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated State: Real Login & Sign Up Screen (No Auto-Login)
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex h-12 w-12 rounded-2xl bg-blue-600 items-center justify-center font-black text-white text-xl shadow-lg shadow-blue-600/30 mb-3">
              P
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              PocketCRM Edge
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Production CRM, Quoting & Invoicing on Cloudflare Workers, D1 & R2
            </p>
          </div>

          <Card className="p-6 border-slate-800 bg-slate-900/90 shadow-2xl">
            <div className="flex rounded-lg bg-slate-950 p-1 mb-6 border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('signin');
                  setAuthError(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  authMode === 'signin'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('signup');
                  setAuthError(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  authMode === 'signup'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Create Account
              </button>
            </div>

            {authError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/60 p-3 text-xs text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {authMode === 'signup' && (
                <>
                  <div>
                    <Label>Full Name</Label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={authName}
                        onChange={(e) => setAuthName(e.target.value)}
                        placeholder="Elena Vance"
                        required
                      />
                      <User className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
                    </div>
                  </div>
                  <div>
                    <Label>Role</Label>
                    <select
                      value={authRole}
                      onChange={(e) => setAuthRole(e.target.value as 'admin' | 'member' | 'viewer')}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    >
                      <option value="admin">Admin (Full Access & Template Studio)</option>
                      <option value="member">Member (Create/Edit Documents & Clients)</option>
                      <option value="viewer">Viewer (Read-Only & Audit Logs)</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <Label>Email Address</Label>
                <Input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="admin@pocketcrm.dev"
                  required
                />
              </div>

              <div>
                <Label>Password</Label>
                <div className="relative">
                  <Input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                  />
                  <KeyRound className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={authSubmitting}
              >
                {authSubmitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : authMode === 'signin' ? (
                  'Sign In to PocketCRM'
                ) : (
                  'Create Secure Account'
                )}
              </Button>
            </form>

            <div className="mt-6 border-t border-slate-800/80 pt-4 text-center">
              <p className="text-[11px] text-slate-400">
                Seeded Admin Credentials: <strong className="text-blue-400">admin@pocketcrm.dev</strong> / <code className="text-slate-300">Admin123!@#</code>
              </p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // 3. Authenticated State: Full Workspace
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Edge Header with Real User Session */}
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
                Edge CRM, Quoting & Invoicing Engine • Better Auth RBAC
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Authenticated User Pill */}
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <div className="text-left text-xs">
                <span className="font-semibold text-white">{currentUser.name}</span>
                <span className="ml-1.5 rounded bg-blue-900/60 text-blue-300 text-[10px] px-1.5 py-0.5 font-bold uppercase">
                  {currentUser.role}
                </span>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refreshWorkspace()}
              title="Refresh Workspace"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSignOut()}
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-400" />
              Sign Out
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

      {/* Main Workspace Navigation */}
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
              <TabsTrigger value="templates">
                <Palette className="w-3.5 h-3.5" />
                Document Templates
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const nextPrefix = docFormType === 'estimate' ? 'EST' : 'INV';
                  setDocNumber(`${nextPrefix}-2026-${Math.floor(1000 + Math.random() * 9000)}`);
                  setDocModalOpen(true);
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                New Quote / Invoice
              </Button>
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
                  Role: <strong className="text-blue-400 uppercase">{currentUser.role}</strong>
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
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-base font-bold text-white">
                    CRM Client Directory
                  </h2>
                  <p className="text-xs text-slate-400">
                    Manage customer contacts, billing addresses, tax IDs, and payment terms.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadClientsTemplate}
                    title="Download Customers CSV Template"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download CSV Template
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setClientImportErrors([]);
                      setClientCsvText('');
                      setClientImportModalOpen(true);
                    }}
                  >
                    <Upload className="w-3.5 h-3.5 text-blue-400" />
                    Import Clients CSV
                  </Button>

                  <Dialog open={clientModalOpen} onOpenChange={setClientModalOpen}>
                    <DialogTrigger asChild>
                      <Button variant="primary" size="sm">
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

            {/* Clients CSV Import Modal */}
            <Dialog open={clientImportModalOpen} onOpenChange={setClientImportModalOpen}>
              <DialogModal
                title="Bulk Import Clients from CSV"
                description="Upload a CSV with company names, codes, contacts, emails, and billing addresses."
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <input
                      type="file"
                      ref={clientCsvInputRef}
                      onChange={handleClientCsvUpload}
                      accept=".csv,text/csv"
                      className="hidden"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => clientCsvInputRef.current?.click()}
                    >
                      <Upload className="w-3.5 h-3.5" /> Select .CSV File
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadClientsTemplate}
                    >
                      <Download className="w-3.5 h-3.5" /> Download Template
                    </Button>
                  </div>

                  <div>
                    <Label>CSV Content</Label>
                    <textarea
                      rows={6}
                      value={clientCsvText}
                      onChange={(e) => setClientCsvText(e.target.value)}
                      placeholder="Paste CSV rows here or choose a file above..."
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {clientImportErrors.length > 0 && (
                    <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3">
                      <h4 className="text-xs font-bold uppercase text-rose-300 mb-1">
                        Validation Errors ({clientImportErrors.length})
                      </h4>
                      <div className="space-y-1 text-xs text-rose-200 font-mono max-h-36 overflow-y-auto">
                        {clientImportErrors.map((err, i) => (
                          <div key={i}>
                            [Row {err.rowNumber}] Field &quot;{err.field}&quot;: {err.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="primary"
                      onClick={handleRunClientCsvImport}
                      disabled={clientImporting || !clientCsvText.trim()}
                    >
                      {clientImporting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                      )}
                      Import Clients to D1
                    </Button>
                  </div>
                </div>
              </DialogModal>
            </Dialog>
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

          {/* 5. CONFIGURABLE DOCUMENT TEMPLATES TAB */}
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

      {/* New Invoice / New Quote Modal with Embedded Line Items CSV Import & Template Download */}
      <Dialog open={docModalOpen} onOpenChange={setDocModalOpen}>
        <DialogModal
          title={docFormType === 'estimate' ? 'Create Estimate / Quote' : 'Create Invoice'}
          description="Atomic D1 batch parent-child insert with live line-items calculation, CSV import, and template download."
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

            {/* Line Items Engine with Embedded CSV Import & Template Download */}
            <div className="border-t border-slate-800 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <Label className="mb-0">
                  Line Items (Supports Unit Prices, Discounts & Taxes)
                </Label>

                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={itemCsvInputRef}
                    onChange={handleItemCsvUpload}
                    accept=".csv,text/csv"
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={downloadItemsTemplate}
                    title="Download deterministic Line Items CSV template"
                  >
                    <Download className="w-3.5 h-3.5" />
                    CSV Template
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => itemCsvInputRef.current?.click()}
                    title="Import line items from CSV"
                  >
                    <Upload className="w-3.5 h-3.5 text-blue-400" />
                    Import CSV
                  </Button>

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
                    <Plus className="w-3.5 h-3.5" /> Add Row
                  </Button>
                </div>
              </div>

              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
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
                        +5% C.
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
  );
}
