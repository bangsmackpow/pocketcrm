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
  KeyRound,
  FileSpreadsheet,
  Users,
  Edit2,
  Lock,
  Sun,
  Moon,
  Settings,
  Package,
  History,
  Image as ImageIcon,
  Mail,
  Send,
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
  signOut,
  fetchUsers,
  createManagedUser,
  updateManagedUser,
  resetManagedUserPassword,
  deleteManagedUser,
  fetchCatalogItems,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  uploadLogo,
  sendInvoiceEmail,
  sendEstimateEmail,
  type AuthUser,
  type ManagedUser,
  type CatalogItem,
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
  // Theme state: defaults to 'light'
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return localStorage.getItem('pocketcrm_theme') === 'dark' ? 'dark' : 'light';
  });

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Main navigation tab: 'dashboard' | 'clients' | 'estimates' | 'invoices' | 'admin'
  const [activeTab, setActiveTab] = useState('dashboard');
  // Admin sub-tab: 'catalog' | 'templates' | 'users' | 'audits'
  const [adminSubTab, setAdminSubTab] = useState('catalog');

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [estimates, setEstimates] = useState<DocumentDto[]>([]);
  const [invoices, setInvoices] = useState<DocumentDto[]>([]);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Clean Login Form State
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // User Manager Modals & Forms State
  const [newUserModalOpen, setNewUserModalOpen] = useState(false);
  const [newUserData, setNewUserData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'member' as 'admin' | 'member' | 'viewer',
  });

  const [editUserModalOpen, setEditUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editUserData, setEditUserData] = useState({
    name: '',
    email: '',
    role: 'member' as 'admin' | 'member' | 'viewer',
    banned: false,
  });

  const [resetPwModalOpen, setResetPwModalOpen] = useState(false);
  const [resetPwUser, setResetPwUser] = useState<ManagedUser | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');

  // Catalog Item Modals & Forms State
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [newItemData, setNewItemData] = useState({
    name: '',
    description: '',
    unitPrice: 150,
    unit: 'hrs',
    defaultTaxRate: 8.25,
  });

  // Client Creation Modal State
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
  const [clientImportErrors, setClientImportErrors] = useState<
    Array<{ rowNumber: number; field: string; message: string }>
  >([]);

  // Native Cloudflare Email Dispatch Modal State
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailDoc, setEmailDoc] = useState<DocumentDto | null>(null);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailCustomMessage, setEmailCustomMessage] = useState('');
  const [emailSending, setEmailSending] = useState(false);

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
      name: 'Professional Services',
      description: 'Specialized enterprise consulting',
      quantity: 10,
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
  ]);

  const itemCsvInputRef = useRef<HTMLInputElement>(null);
  const clientCsvInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Template Studio State
  const [editingTemplate, setEditingTemplate] = useState<TemplateDto | null>(null);

  // Apply theme to HTML root element
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('pocketcrm_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

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
      const isManagerOrAdmin = currentUser.role === 'admin' || currentUser.role === 'member';

      const promises: [
        Promise<DashboardData>,
        Promise<{ clients: ClientDto[] }>,
        Promise<{ estimates: DocumentDto[] }>,
        Promise<{ invoices: DocumentDto[] }>,
        Promise<{ templates: TemplateDto[] }>,
        Promise<CatalogItem[]>,
        Promise<ManagedUser[]>
      ] = [
        apiFetch<DashboardData>('/api/dashboard'),
        apiFetch<{ clients: ClientDto[] }>('/api/clients'),
        apiFetch<{ estimates: DocumentDto[] }>('/api/estimates'),
        apiFetch<{ invoices: DocumentDto[] }>('/api/invoices'),
        apiFetch<{ templates: TemplateDto[] }>('/api/templates'),
        fetchCatalogItems(),
        isManagerOrAdmin ? fetchUsers() : Promise.resolve([]),
      ];

      const [dashRes, cliRes, estRes, invRes, tplRes, itemsRes, usersRes] = await Promise.all(promises);

      setDashboard(dashRes);
      setClients(cliRes.clients || []);
      setEstimates(estRes.estimates || []);
      setInvoices(invRes.invoices || []);
      setTemplates(tplRes.templates || []);
      setCatalogItems(itemsRes || []);
      setManagedUsers(usersRes || []);

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

  // Auth Submit (Sign In Only)
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);

    try {
      await signInEmail(authEmail, authPassword);
      const user = await checkAuth();
      if (user) {
        notify('success', `Welcome back, ${user.name}!`);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid email or password.');
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

  // User Management Actions
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createManagedUser(newUserData);
      setNewUserModalOpen(false);
      setNewUserData({ name: '', email: '', password: '', role: 'member' });
      notify('success', `User ${newUserData.name} created successfully.`);
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await updateManagedUser(editingUser.id, editUserData);
      setEditUserModalOpen(false);
      setEditingUser(null);
      notify('success', `User ${editUserData.name} updated successfully.`);
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwUser) return;
    try {
      await resetManagedUserPassword(resetPwUser.id, newPasswordInput);
      setResetPwModalOpen(false);
      setResetPwUser(null);
      setNewPasswordInput('');
      notify('success', `Password reset successfully for ${resetPwUser.email}.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to reset password');
    }
  };

  const handleDeleteUser = async (user: ManagedUser) => {
    if (!confirm(`Are you sure you want to delete user ${user.name} (${user.email})?`)) {
      return;
    }
    try {
      await deleteManagedUser(user.id);
      notify('success', `User ${user.name} deleted.`);
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  // Catalog Item Actions
  const handleCreateCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCatalogItem(newItemData);
      setItemModalOpen(false);
      setNewItemData({
        name: '',
        description: '',
        unitPrice: 150,
        unit: 'hrs',
        defaultTaxRate: 8.25,
      });
      notify('success', `Catalog item "${newItemData.name}" created.`);
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create catalog item');
    }
  };

  const handleDeleteCatalogItem = async (id: string, name: string) => {
    if (!confirm(`Delete catalog item "${name}"?`)) return;
    try {
      await deleteCatalogItem(id);
      notify('success', `Item "${name}" removed from catalog.`);
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  // Add Item from Catalog to Document Line Items
  const handleAddFromCatalog = (item: CatalogItem) => {
    setDocItems([
      ...docItems,
      {
        name: item.name,
        description: item.description,
        quantity: 1,
        unit: item.unit,
        unitPrice: item.unitPrice,
        discountType: 'percentage',
        discountValue: 0,
        taxName: 'Tax',
        taxRate: item.defaultTaxRate,
        taxCompound: false,
        secondTaxRate: 0,
        secondTaxCompound: false,
      },
    ]);
    notify('success', `Added "${item.name}" from catalog ($${item.unitPrice.toFixed(2)}/${item.unit}).`);
  };

  // Logo Upload Handler
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingTemplate) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target?.result as string;
      try {
        const logoUrl = await uploadLogo(editingTemplate.id, dataUrl, file.name);
        setEditingTemplate({
          ...editingTemplate,
          logoUrl,
        });
        notify('success', 'Logo uploaded successfully and applied to document template.');
        await refreshWorkspace();
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Logo upload failed');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
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
      const res = await apiFetch<{
        importedCount: number;
        errors: Array<{ rowNumber: number; field: string; message: string }>;
      }>('/api/clients/import-csv', {
        method: 'POST',
        body: JSON.stringify({ csvText: clientCsvText }),
      });
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
      'Application Development,Full-stack edge application engineering,40,hrs,175.00,8.25,false\n' +
      'Professional Services,Architecture review and systems integration,10,hrs,150.00,8.25,false';
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
        `${docFormType === 'estimate' ? 'Estimate' : 'Invoice'} ${docNumber} created.`
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
      notify('success', `Estimate converted to Invoice ${res.invoice.documentNumber}!`);
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
      notify(
        'success',
        `Recorded payment of ${inv.currency} ${partialAmount.toFixed(2)} for ${inv.documentNumber}`
      );
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Payment recording failed');
    }
  };

  const openSendEstimateModal = (est: DocumentDto) => {
    setEmailDoc(est);
    const client = clients.find((c) => c.id === est.clientId);
    setEmailRecipient(client?.email || '');
    setEmailSubject(`Estimate #${est.documentNumber} from Built Networks`);
    setEmailCustomMessage('');
    setEmailModalOpen(true);
  };

  const openSendInvoiceModal = (inv: DocumentDto) => {
    setEmailDoc(inv);
    const client = clients.find((c) => c.id === inv.clientId);
    setEmailRecipient(client?.email || '');
    setEmailSubject(`Invoice #${inv.documentNumber} from Built Networks`);
    setEmailCustomMessage('');
    setEmailModalOpen(true);
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailDoc || !emailRecipient) return;
    setEmailSending(true);
    try {
      const payload = {
        recipientEmail: emailRecipient,
        subject: emailSubject,
        customMessage: emailCustomMessage,
      };
      const res =
        emailDoc.type === 'invoice'
          ? await sendInvoiceEmail(emailDoc.id, payload)
          : await sendEstimateEmail(emailDoc.id, payload);

      if (res.success) {
        notify(
          'success',
          res.simulated
            ? `Email simulated to ${emailRecipient} (native send_email binding ready).`
            : `Dispatched native Cloudflare email + PDF to ${emailRecipient}!`
        );
        setEmailModalOpen(false);
        await refreshWorkspace();
      } else {
        notify('error', `Dispatch failed: ${res.message}`);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setEmailSending(false);
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
      notify('success', `Updated template "${editingTemplate.name}".`);
      await refreshWorkspace();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update template');
    }
  };

  // 1. Loading State
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
          <span>Connecting to PocketCRM Secure Edge...</span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated State: Clean Login Screen (Default Light Mode / Dark Toggle)
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center px-4 py-12 transition-colors">
        <div className="absolute top-4 right-4">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Toggle color theme"
          >
            {theme === 'light' ? (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-600" /> Dark
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" /> Light
              </>
            )}
          </button>
        </div>

        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex h-12 w-12 rounded-2xl bg-blue-600 items-center justify-center font-black text-white text-xl shadow-lg shadow-blue-600/30 mb-3">
              P
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              PocketCRM Edge
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Sign in to access your CRM, Quoting & Invoicing workspace
            </p>
          </div>

          <Card className="p-6">
            {authError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div>
                <Label>Email Address</Label>
                <Input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
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
                    autoComplete="current-password"
                    required
                  />
                  <KeyRound className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={authSubmitting}
              >
                {authSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Sign In'}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  const isManagerOrAdmin = currentUser.role === 'admin' || currentUser.role === 'member';

  // 3. Authenticated State: Clean, Streamlined Workspace
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 dark:border-slate-800/80 dark:bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center font-black text-white shadow-md shadow-blue-600/30">
              P
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white">
                  PocketCRM
                </span>
                <span className="rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-400">
                  Cloudflare Edge
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Toggle (Light / Dark) */}
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              title="Toggle Light/Dark Theme"
            >
              {theme === 'light' ? (
                <>
                  <Moon className="w-3.5 h-3.5 text-slate-700" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              ) : (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Light</span>
                </>
              )}
            </button>

            {/* Authenticated User Pill */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <div className="text-left text-xs">
                <span className="font-semibold text-slate-800 dark:text-white">{currentUser.name}</span>
                <span className="ml-1.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 text-[10px] px-1.5 py-0.5 font-bold uppercase">
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
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSignOut()}
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
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
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-200'
                : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {bannerMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
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

      {/* Main Workspace Navigation: Clean & Focused */}
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
              {isManagerOrAdmin && (
                <TabsTrigger value="admin">
                  <Settings className="w-3.5 h-3.5" />
                  Admin
                </TabsTrigger>
              )}
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
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Total Invoiced Revenue
                </div>
                <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
                  ${dashboard?.kpis.totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
                <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                  Collected: ${dashboard?.kpis.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
              </Card>

              <Card className="p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Outstanding Receivables
                </div>
                <div className="mt-2 text-2xl font-black text-amber-600 dark:text-amber-400">
                  ${dashboard?.kpis.totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
                <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  Overdue: ${dashboard?.kpis.overdueAmount.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
              </Card>

              <Card className="p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Estimates / Quote Pipeline
                </div>
                <div className="mt-2 text-2xl font-black text-sky-600 dark:text-sky-400">
                  ${dashboard?.kpis.openPipelineValue.toLocaleString('en-US', { minimumFractionDigits: 2 }) ?? '0.00'}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {dashboard?.kpis.estimateCount ?? 0} active quotes
                </div>
              </Card>

              <Card className="p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Active Enterprise Clients
                </div>
                <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
                  {dashboard?.kpis.activeClients ?? 0}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Role: <strong className="text-blue-600 dark:text-blue-400 uppercase">{currentUser.role}</strong>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="p-5 lg:col-span-2">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Recent Invoices & Quotes
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-3">Number</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3">Client</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {[...invoices, ...estimates].slice(0, 8).map((doc) => (
                        <tr key={doc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                            {doc.documentNumber}
                          </td>
                          <td className="py-2.5 px-3 capitalize text-slate-600 dark:text-slate-300">
                            {doc.type}
                          </td>
                          <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200">
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
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-4">
                  Immutable Audit Trail (D1)
                </h2>
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {dashboard?.recentAudits.map((aud) => (
                    <div
                      key={aud.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800/80 dark:bg-slate-950/60"
                    >
                      <div className="flex items-center justify-between font-semibold text-blue-600 dark:text-blue-400">
                        <span>{aud.action}</span>
                        <span className="text-[10px] text-slate-500 uppercase">
                          {aud.entityType}
                        </span>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 mt-1 truncate">
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
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    CRM Client Directory
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
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
                    <Upload className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
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
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
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
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-3">Code</th>
                      <th className="py-3 px-3">Company</th>
                      <th className="py-3 px-3">Primary Contact</th>
                      <th className="py-3 px-3">Tax ID</th>
                      <th className="py-3 px-3">Terms</th>
                      <th className="py-3 px-3">Billing City</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {clients.map((cli) => (
                      <tr key={cli.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-3 font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                          {cli.code}
                        </td>
                        <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                          {cli.companyName}
                        </td>
                        <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                          <div>{cli.contactName}</div>
                          <div className="text-xs text-slate-500">{cli.email}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                          {cli.taxIdentifier || '—'}
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                          Net {cli.paymentTermsDays}d ({cli.currency})
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-500 dark:text-slate-400">
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
                      className="w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                    />
                  </div>

                  {clientImportErrors.length > 0 && (
                    <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 dark:border-rose-500/40 dark:bg-rose-950/30">
                      <h4 className="text-xs font-bold uppercase text-rose-800 dark:text-rose-300 mb-1">
                        Validation Errors ({clientImportErrors.length})
                      </h4>
                      <div className="space-y-1 text-xs text-rose-700 dark:text-rose-200 font-mono max-h-36 overflow-y-auto">
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
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Estimates & Quotes Workflow
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    State Transitions: Draft → Sent → Approved / Rejected → Converted to Invoice
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-3">Estimate #</th>
                      <th className="py-3 px-3">Client</th>
                      <th className="py-3 px-3">Issue / Expiry</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Total</th>
                      <th className="py-3 px-3 text-right">Workflow Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {estimates.map((est) => (
                      <tr key={est.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-3 font-mono font-bold text-blue-600 dark:text-blue-400">
                          {est.documentNumber}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {est.client?.companyName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {est.client?.code}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                          {est.issueDate} → {est.dueDate}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={est.status} />
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-white">
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
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openSendEstimateModal(est)}
                              className="border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                              title="Send to client via Cloudflare Native Email"
                            >
                              <Mail className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                              Email
                            </Button>
                            <a
                              href={`/api/estimates/${est.id}/pdf?format=html`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Preview
                            </a>
                            <a
                              href={`/api/estimates/${est.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Invoices & Receivables Workflow
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    State Transitions: Draft → Sent → Partial / Paid → Overdue → Cancelled
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-3">Invoice #</th>
                      <th className="py-3 px-3">Client</th>
                      <th className="py-3 px-3">Due Date</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Total</th>
                      <th className="py-3 px-3 text-right">Balance Due</th>
                      <th className="py-3 px-3 text-right">Workflow Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-3 font-mono font-bold text-blue-600 dark:text-blue-400">
                          {inv.documentNumber}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {inv.client?.companyName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {inv.client?.code}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                          {inv.dueDate}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-slate-900 dark:text-white">
                          {inv.currency} ${inv.total.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-amber-600 dark:text-amber-400">
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
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openSendInvoiceModal(inv)}
                              className="border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                              title="Send to client via Cloudflare Native Email"
                            >
                              <Mail className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                              Email
                            </Button>
                            <a
                              href={`/api/invoices/${inv.id}/pdf?format=html`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Preview
                            </a>
                            <a
                              href={`/api/invoices/${inv.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800"
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

          {/* 5. CONSOLIDATED ADMIN & SETTINGS AREA */}
          {isManagerOrAdmin && (
            <TabsContent value="admin" className="space-y-6">
              {/* Clean Admin Sub-navigation Header */}
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      Administration & Settings
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Configure services catalog, document branding, team access, and view audit history.
                    </p>
                  </div>
                </div>

                <div className="flex rounded-lg bg-slate-200/80 dark:bg-slate-900 p-1 border border-slate-300/80 dark:border-slate-800 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setAdminSubTab('catalog')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                      adminSubTab === 'catalog'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5" />
                    Product Catalog ({catalogItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminSubTab('templates')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                      adminSubTab === 'templates'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <Palette className="w-3.5 h-3.5" />
                    Templates & Logo
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminSubTab('users')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                      adminSubTab === 'users'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    Team & Users ({managedUsers.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminSubTab('audits')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                      adminSubTab === 'audits'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" />
                    Audit Logs
                  </button>
                </div>
              </div>

              {/* Sub-view A: Product & Service Catalog (Item Inventory) */}
              {adminSubTab === 'catalog' && (
                <Card className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        Product & Service Catalog (Item Inventory)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Define default services, rates, and units for instant one-click insertion into quotes and invoices.
                      </p>
                    </div>

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setItemModalOpen(true)}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Catalog Item
                    </Button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                          <th className="py-3 px-3">Service / Product Name</th>
                          <th className="py-3 px-3">Description</th>
                          <th className="py-3 px-3">Default Rate</th>
                          <th className="py-3 px-3">Unit</th>
                          <th className="py-3 px-3">Default Tax %</th>
                          <th className="py-3 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {catalogItems.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                            <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                              {item.name}
                            </td>
                            <td className="py-3 px-3 text-xs text-slate-500 dark:text-slate-400 max-w-xs truncate">
                              {item.description || '—'}
                            </td>
                            <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                              ${item.unitPrice.toFixed(2)}
                            </td>
                            <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                              {item.unit}
                            </td>
                            <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                              {item.defaultTaxRate}%
                            </td>
                            <td className="py-3 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => void handleDeleteCatalogItem(item.id, item.name)}
                                className="text-rose-600 dark:text-rose-400 hover:text-rose-700 p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                title="Delete item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Add Catalog Item Modal */}
                  <Dialog open={itemModalOpen} onOpenChange={setItemModalOpen}>
                    <DialogModal
                      title="Add Service / Product to Catalog"
                      description="Create a standard item with a default price to speed up quote and invoice generation."
                    >
                      <form onSubmit={handleCreateCatalogItem} className="space-y-4">
                        <div>
                          <Label>Service / Item Name</Label>
                          <Input
                            value={newItemData.name}
                            onChange={(e) =>
                              setNewItemData({ ...newItemData, name: e.target.value })
                            }
                            placeholder="Application Development"
                            required
                          />
                        </div>

                        <div>
                          <Label>Description</Label>
                          <Input
                            value={newItemData.description}
                            onChange={(e) =>
                              setNewItemData({ ...newItemData, description: e.target.value })
                            }
                            placeholder="Full-stack edge application engineering"
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label>Unit Price ($)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={newItemData.unitPrice}
                              onChange={(e) =>
                                setNewItemData({
                                  ...newItemData,
                                  unitPrice: Number(e.target.value),
                                })
                              }
                              required
                            />
                          </div>

                          <div>
                            <Label>Unit</Label>
                            <Input
                              value={newItemData.unit}
                              onChange={(e) =>
                                setNewItemData({ ...newItemData, unit: e.target.value })
                              }
                              placeholder="hrs, units, fixed"
                              required
                            />
                          </div>

                          <div>
                            <Label>Default Tax %</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={newItemData.defaultTaxRate}
                              onChange={(e) =>
                                setNewItemData({
                                  ...newItemData,
                                  defaultTaxRate: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <Button type="submit" variant="primary">
                            Save to Inventory
                          </Button>
                        </div>
                      </form>
                    </DialogModal>
                  </Dialog>
                </Card>
              )}

              {/* Sub-view B: Document Templates & Logo */}
              {adminSubTab === 'templates' && editingTemplate && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="p-6">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                      Document Branding & Logo Configuration
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                      Upload your company logo, set alignment, colors, payment instructions, and legal clauses.
                    </p>

                    <form onSubmit={handleSaveTemplate} className="space-y-4">
                      {/* Logo Upload Section */}
                      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950">
                        <Label>Company Logo (Quotes & Invoices)</Label>
                        <div className="flex items-center gap-4 mt-2">
                          {editingTemplate.logoUrl ? (
                            <img
                              src={editingTemplate.logoUrl}
                              alt="Uploaded logo"
                              className="h-12 w-auto max-w-[150px] object-contain border border-slate-200 dark:border-slate-800 rounded p-1 bg-white"
                            />
                          ) : (
                            <div className="h-12 w-28 rounded border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-[10px] text-slate-400">
                              No Logo
                            </div>
                          )}

                          <input
                            type="file"
                            ref={logoInputRef}
                            onChange={handleLogoUpload}
                            accept="image/png,image/jpeg,image/svg+xml,image/webp"
                            className="hidden"
                          />

                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => logoInputRef.current?.click()}
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                            {editingTemplate.logoUrl ? 'Change Logo' : 'Upload Logo'}
                          </Button>

                          {editingTemplate.logoUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setEditingTemplate({
                                  ...editingTemplate,
                                  logoUrl: null,
                                })
                              }
                              className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

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
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                          >
                            <option value="left">Left Aligned</option>
                            <option value="center">Centered</option>
                            <option value="right">Right Aligned</option>
                          </select>
                        </div>
                        <div>
                          <Label>Primary Color</Label>
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
                          <Label>Accent Color</Label>
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
                          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
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
                          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
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
                          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                        />
                      </div>

                      <div className="flex justify-end">
                        <Button type="submit" variant="primary">
                          Save Branding & Template
                        </Button>
                      </div>
                    </form>
                  </Card>

                  {/* Live Styled Preview */}
                  <Card className="p-6 bg-white text-slate-900 overflow-hidden shadow-md">
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
                        {editingTemplate.logoUrl ? (
                          <img
                            src={editingTemplate.logoUrl}
                            alt="Logo"
                            style={{ maxHeight: '50px', maxWidth: '200px', objectFit: 'contain' }}
                          />
                        ) : (
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
                            POCKETCRM • LIVE PREVIEW
                          </span>
                        )}
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
                          Application Development (Sample)
                        </div>
                        <div className="flex justify-between text-slate-500 mt-1">
                          <span>40 hrs × $175.00 (+8.25% Tax)</span>
                          <span className="font-bold text-slate-900">$7,577.50</span>
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

              {/* Sub-view C: Team & Users */}
              {adminSubTab === 'users' && (
                <Card className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        Team & User Access Control
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Manage member accounts, assign RBAC permissions, and reset credentials.
                      </p>
                    </div>

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setNewUserData({ name: '', email: '', password: '', role: 'member' });
                        setNewUserModalOpen(true);
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New User
                    </Button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                          <th className="py-3 px-3">Name</th>
                          <th className="py-3 px-3">Email</th>
                          <th className="py-3 px-3">Role</th>
                          <th className="py-3 px-3">Status</th>
                          <th className="py-3 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {managedUsers.map((user) => (
                          <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                            <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                              {user.name}
                              {user.id === currentUser.id && (
                                <span className="ml-2 rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-400">
                                  You
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-slate-600 dark:text-slate-300 font-mono text-xs">
                              {user.email}
                            </td>
                            <td className="py-3 px-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800/60">
                                {user.role}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                                  user.banned
                                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                }`}
                              >
                                {user.banned ? 'Suspended' : 'Active'}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="inline-flex items-center gap-1.5 justify-end">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditingUser(user);
                                    setEditUserData({
                                      name: user.name,
                                      email: user.email,
                                      role: user.role,
                                      banned: Boolean(user.banned),
                                    });
                                    setEditUserModalOpen(true);
                                  }}
                                  title="Edit user info"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  Edit
                                </Button>

                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setResetPwUser(user);
                                    setNewPasswordInput('');
                                    setResetPwModalOpen(true);
                                  }}
                                  title="Reset user password"
                                >
                                  <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                  Reset PW
                                </Button>

                                {currentUser.role === 'admin' && user.id !== currentUser.id && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteUser(user)}
                                    className="text-rose-600 dark:text-rose-400 hover:text-rose-700 p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                    title="Delete user"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Create User Modal */}
                  <Dialog open={newUserModalOpen} onOpenChange={setNewUserModalOpen}>
                    <DialogModal
                      title="Create New User"
                      description="Add a team member account and set their role and initial password."
                    >
                      <form onSubmit={handleCreateUser} className="space-y-4">
                        <div>
                          <Label>Full Name</Label>
                          <Input
                            type="text"
                            value={newUserData.name}
                            onChange={(e) =>
                              setNewUserData({ ...newUserData, name: e.target.value })
                            }
                            placeholder="Sarah Connor"
                            required
                          />
                        </div>

                        <div>
                          <Label>Email Address</Label>
                          <Input
                            type="email"
                            value={newUserData.email}
                            onChange={(e) =>
                              setNewUserData({ ...newUserData, email: e.target.value })
                            }
                            placeholder="sarah@company.com"
                            required
                          />
                        </div>

                        <div>
                          <Label>Role</Label>
                          <select
                            value={newUserData.role}
                            onChange={(e) =>
                              setNewUserData({
                                ...newUserData,
                                role: e.target.value as 'admin' | 'member' | 'viewer',
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                          >
                            <option value="admin">Admin (Full Access & Templates)</option>
                            <option value="member">Member / Manager (Manage Docs & Clients)</option>
                            <option value="viewer">Viewer (Read-Only & Auditing)</option>
                          </select>
                        </div>

                        <div>
                          <Label>Initial Password (min 8 characters)</Label>
                          <Input
                            type="password"
                            value={newUserData.password}
                            onChange={(e) =>
                              setNewUserData({ ...newUserData, password: e.target.value })
                            }
                            placeholder="••••••••••••"
                            minLength={8}
                            required
                          />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <Button type="submit" variant="primary">
                            Create Account
                          </Button>
                        </div>
                      </form>
                    </DialogModal>
                  </Dialog>

                  {/* Edit User Modal */}
                  <Dialog open={editUserModalOpen} onOpenChange={setEditUserModalOpen}>
                    <DialogModal
                      title="Edit User Profile"
                      description={`Update details and permissions for ${editingUser?.name || 'user'}.`}
                    >
                      <form onSubmit={handleUpdateUser} className="space-y-4">
                        <div>
                          <Label>Full Name</Label>
                          <Input
                            type="text"
                            value={editUserData.name}
                            onChange={(e) =>
                              setEditUserData({ ...editUserData, name: e.target.value })
                            }
                            required
                          />
                        </div>

                        <div>
                          <Label>Email Address</Label>
                          <Input
                            type="email"
                            value={editUserData.email}
                            onChange={(e) =>
                              setEditUserData({ ...editUserData, email: e.target.value })
                            }
                            required
                          />
                        </div>

                        <div>
                          <Label>Role</Label>
                          <select
                            value={editUserData.role}
                            onChange={(e) =>
                              setEditUserData({
                                ...editUserData,
                                role: e.target.value as 'admin' | 'member' | 'viewer',
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                          >
                            <option value="admin">Admin (Full Access & Templates)</option>
                            <option value="member">Member / Manager (Manage Docs & Clients)</option>
                            <option value="viewer">Viewer (Read-Only & Auditing)</option>
                          </select>
                        </div>

                        <div>
                          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                            <input
                              type="checkbox"
                              checked={editUserData.banned}
                              onChange={(e) =>
                                setEditUserData({ ...editUserData, banned: e.target.checked })
                              }
                            />
                            Suspend / Ban this user account
                          </label>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <Button type="submit" variant="primary">
                            Save Changes
                          </Button>
                        </div>
                      </form>
                    </DialogModal>
                  </Dialog>

                  {/* Reset Password Modal */}
                  <Dialog open={resetPwModalOpen} onOpenChange={setResetPwModalOpen}>
                    <DialogModal
                      title="Reset User Password"
                      description={`Set a new password for ${resetPwUser?.email}.`}
                    >
                      <form onSubmit={handleResetPassword} className="space-y-4">
                        <div>
                          <Label>New Password (min 8 characters)</Label>
                          <Input
                            type="password"
                            value={newPasswordInput}
                            onChange={(e) => setNewPasswordInput(e.target.value)}
                            placeholder="••••••••••••"
                            minLength={8}
                            required
                          />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <Button type="submit" variant="primary">
                            Update Password
                          </Button>
                        </div>
                      </form>
                    </DialogModal>
                  </Dialog>
                </Card>
              )}

              {/* Sub-view D: Audit Trail */}
              {adminSubTab === 'audits' && (
                <Card className="p-5">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                    System Audit Trail (Cloudflare D1)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Immutable history of logins, document state changes, and catalog updates.
                  </p>
                  <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                    {dashboard?.recentAudits.map((aud) => (
                      <div
                        key={aud.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800/80 dark:bg-slate-950/60"
                      >
                        <div className="flex items-center justify-between font-semibold text-blue-600 dark:text-blue-400">
                          <span>{aud.action}</span>
                          <span className="text-[10px] text-slate-500 uppercase">
                            {aud.entityType}
                          </span>
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-1 truncate">
                          Actor: {aud.actorEmail || 'system'} • Entity ID: {aud.entityId} • Date: {new Date(aud.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </TabsContent>
          )}
        </Tabs>
      </main>

      {/* New Invoice / New Quote Modal with Quick Catalog Picker & Embedded CSV Import */}
      <Dialog open={docModalOpen} onOpenChange={setDocModalOpen}>
        <DialogModal
          title={docFormType === 'estimate' ? 'Create Estimate / Quote' : 'Create Invoice'}
          description="Atomic D1 batch parent-child insert with live line-items calculation, catalog picker, and CSV import."
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
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

            {/* Quick Catalog Insertion Bar */}
            {catalogItems.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <Package className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Quick Add from Service Catalog:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {catalogItems.slice(0, 4).map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => handleAddFromCatalog(cat)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer shadow-xs"
                      >
                        <Plus className="w-3 h-3 text-blue-600" />
                        {cat.name} (${cat.unitPrice}/{cat.unit})
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Line Items Engine with Embedded CSV Import & Template Download */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <Label className="mb-0">
                  Line Items ({docItems.length})
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
                    <Upload className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
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
                          name: 'Custom Service',
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
                    className="grid grid-cols-12 gap-2 items-center rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800/90 dark:bg-slate-950/70"
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
                      <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer">
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
                          className="text-rose-600 dark:text-rose-400 hover:text-rose-700 p-1 cursor-pointer"
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
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-100 p-4 border border-slate-200 dark:bg-slate-950 dark:border-slate-800">
              <div className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                <div>
                  Subtotal:{' '}
                  <strong className="text-slate-900 dark:text-slate-200">
                    ${liveCalculation.subtotal.toFixed(2)}
                  </strong>
                </div>
                <div>
                  Discount Total:{' '}
                  <strong className="text-amber-600 dark:text-amber-400">
                    -${liveCalculation.discountTotal.toFixed(2)}
                  </strong>
                </div>
                <div>
                  Tax Total:{' '}
                  <strong className="text-sky-600 dark:text-sky-400">
                    +${liveCalculation.taxTotal.toFixed(2)}
                  </strong>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Calculated Grand Total
                </div>
                <div className="text-2xl font-black text-slate-900 dark:text-white">
                  {docCurrency} ${liveCalculation.total.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="submit" variant="primary">
                Commit Document to D1
              </Button>
            </div>
          </form>
        </DialogModal>
      </Dialog>

      {/* 7. NATIVE CLOUDFLARE EMAIL DISPATCH MODAL */}
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogModal
          title={`Send ${emailDoc?.type === 'invoice' ? 'Invoice' : 'Estimate'} via Native Cloudflare Email`}
        >
          <form onSubmit={handleSendEmail} className="space-y-4">
            <div className="rounded-lg bg-indigo-50 p-3.5 text-xs text-indigo-900 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-800/60">
              <div className="flex items-center gap-2 font-semibold">
                <Mail className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Cloudflare Native Edge Email (`send_email` binding)
              </div>
              <p className="mt-1 text-slate-600 dark:text-slate-300">
                Dispatched securely from{' '}
                <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                  invoicing@billing.builtnetworks.com
                </span>{' '}
                with attached PDF (
                <span className="font-mono">{emailDoc?.documentNumber}.pdf</span>) and responsive HTML summary.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Recipient Email Address *</Label>
              <Input
                type="email"
                required
                value={emailRecipient}
                onChange={(e) => setEmailRecipient(e.target.value)}
                placeholder="client-ap@domain.com"
              />
            </div>

            <div className="space-y-1">
              <Label>Subject Line</Label>
              <Input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Subject"
              />
            </div>

            <div className="space-y-1">
              <Label>Optional Personal Note / Custom Message</Label>
              <textarea
                rows={3}
                value={emailCustomMessage}
                onChange={(e) => setEmailCustomMessage(e.target.value)}
                placeholder="e.g. Hi Sarah, here is the updated document. Please let us know if you have any questions!"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEmailModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={emailSending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {emailSending ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Dispatching via Cloudflare...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    Send Email + PDF
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogModal>
      </Dialog>
    </div>
  );
}
