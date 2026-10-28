import React, { useState } from 'react';
import {
  Repeat,
  Plus,
  Play,
  Pause,
  Trash2,
  Edit2,
  Calendar,
  Clock,
  Building2,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Send,
  ChevronRight,
} from 'lucide-react';
import { Button, Card } from './ui';
import type {
  ClientDto,
  CatalogItem,
  AuthUser,
  RecurringScheduleDto,
} from '../api';
import {
  createRecurringSchedule,
  updateRecurringSchedule,
  toggleRecurringSchedule,
  runRecurringScheduleNow,
  deleteRecurringSchedule,
  fetchRecurringSchedule,
} from '../api';

interface RecurringTabProps {
  schedules: RecurringScheduleDto[];
  clients: ClientDto[];
  catalogItems: CatalogItem[];
  currentUser: AuthUser;
  draftInvoiceCount: number;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', text: string) => void;
  onNavigateToDraftInvoices: () => void;
}

interface ScheduleLineItem {
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxRate: number;
}

export function RecurringTab({
  schedules,
  clients,
  catalogItems,
  currentUser,
  draftInvoiceCount,
  onRefresh,
  onNotify,
  onNavigateToDraftInvoices,
}: RecurringTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Form State
  const [formClientId, setFormClientId] = useState('');
  const [formProfileName, setFormProfileName] = useState('');
  const [formFrequency, setFormFrequency] = useState('monthly');
  const [formNextRunDate, setFormNextRunDate] = useState(
    new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  );
  const [formSendReminder, setFormSendReminder] = useState(true);
  const [formNotes, setFormNotes] = useState('');
  const [formTerms, setFormTerms] = useState('Due within 30 days of invoice date');
  const [formItems, setFormItems] = useState<ScheduleLineItem[]>([
    {
      name: 'Monthly Maintenance & Support Retainer',
      description: 'Standard monthly support contract',
      quantity: 1,
      unit: 'mo',
      unitPrice: 1500,
      taxRate: 0,
    },
  ]);

  const activeSchedules = schedules.filter((s) => s.status === 'active');
  const totalMonthlyRun = activeSchedules.reduce((acc, s) => {
    if (s.frequency === 'monthly') return acc + s.total;
    if (s.frequency === 'weekly') return acc + s.total * 4.33;
    if (s.frequency === 'quarterly') return acc + s.total / 3;
    if (s.frequency === 'annually') return acc + s.total / 12;
    return acc;
  }, 0);

  const openNewModal = () => {
    setEditingId(null);
    setFormClientId(clients[0]?.id || '');
    setFormProfileName('');
    setFormFrequency('monthly');
    setFormNextRunDate(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    setFormSendReminder(true);
    setFormNotes('');
    setFormTerms('Due within 30 days of invoice date');
    setFormItems([
      {
        name: 'Monthly Maintenance & Support Retainer',
        description: 'Standard monthly support contract',
        quantity: 1,
        unit: 'mo',
        unitPrice: 1500,
        taxRate: 0,
      },
    ]);
    setModalOpen(true);
  };

  const openEditModal = async (schedule: RecurringScheduleDto) => {
    try {
      const res = await fetchRecurringSchedule(schedule.id);
      setEditingId(schedule.id);
      setFormClientId(schedule.clientId);
      setFormProfileName(schedule.profileName);
      setFormFrequency(schedule.frequency);
      setFormNextRunDate(schedule.nextRunDate);
      setFormSendReminder(schedule.sendAdminReminder);
      setFormNotes(schedule.notes || '');
      setFormTerms(schedule.terms || '');
      if (res.items && res.items.length > 0) {
        setFormItems(
          res.items.map((i) => ({
            name: i.name,
            description: i.description || '',
            quantity: i.quantity,
            unit: i.unit || 'hrs',
            unitPrice: i.unitPrice,
            taxRate: i.taxRate || 0,
          }))
        );
      }
      setModalOpen(true);
    } catch (err: any) {
      onNotify('error', `Failed to load retainer: ${err.message}`);
    }
  };

  const handleAddItem = () => {
    setFormItems([
      ...formItems,
      {
        name: '',
        description: '',
        quantity: 1,
        unit: 'hrs',
        unitPrice: 150,
        taxRate: 0,
      },
    ]);
  };

  const handleRemoveItem = (idx: number) => {
    if (formItems.length <= 1) return;
    setFormItems(formItems.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, field: keyof ScheduleLineItem, val: any) => {
    const updated = [...formItems];
    updated[idx] = { ...updated[idx], [field]: val };
    setFormItems(updated);
  };

  const handleSelectCatalogItem = (idx: number, catalogId: string) => {
    const cat = catalogItems.find((c) => c.id === catalogId);
    if (!cat) return;
    const updated = [...formItems];
    updated[idx] = {
      ...updated[idx],
      name: cat.name,
      description: cat.description || '',
      unitPrice: cat.unitPrice,
      unit: cat.unit,
      taxRate: cat.defaultTaxRate || 0,
    };
    setFormItems(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClientId || !formProfileName.trim() || formItems.length === 0) {
      onNotify('error', 'Please fill in client, retainer name, and at least one item.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        clientId: formClientId,
        profileName: formProfileName.trim(),
        frequency: formFrequency,
        nextRunDate: formNextRunDate,
        sendAdminReminder: formSendReminder,
        notes: formNotes.trim(),
        terms: formTerms.trim(),
        items: formItems.map((i) => ({
          name: i.name,
          description: i.description,
          quantity: Number(i.quantity) || 1,
          unit: i.unit,
          unitPrice: Number(i.unitPrice) || 0,
          taxRate: Number(i.taxRate) || 0,
        })),
      };

      if (editingId) {
        await updateRecurringSchedule(editingId, payload);
        onNotify('success', `Retainer "${formProfileName}" updated!`);
      } else {
        await createRecurringSchedule(payload);
        onNotify('success', `Retainer "${formProfileName}" scheduled successfully!`);
      }

      setModalOpen(false);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to save recurring retainer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (schedule: RecurringScheduleDto) => {
    try {
      const res = await toggleRecurringSchedule(schedule.id);
      onNotify('success', `Retainer is now ${res.status.toUpperCase()}`);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', `Failed to toggle schedule: ${err.message}`);
    }
  };

  const handleRunNow = async (schedule: RecurringScheduleDto) => {
    try {
      setRunningId(schedule.id);
      const res = await runRecurringScheduleNow(schedule.id);
      onNotify('success', `Draft invoice #${res.invoiceNumber} generated and ready for review!`);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', `Manual run failed: ${err.message}`);
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async (schedule: RecurringScheduleDto) => {
    if (!confirm(`Are you sure you want to permanently delete recurring retainer "${schedule.profileName}"?`)) {
      return;
    }
    try {
      await deleteRecurringSchedule(schedule.id);
      onNotify('success', `Retainer "${schedule.profileName}" deleted.`);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', `Failed to delete schedule: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Draft Review Banner */}
      {draftInvoiceCount > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-blue-950 dark:text-blue-100">
                {draftInvoiceCount} Draft {draftInvoiceCount === 1 ? 'Invoice' : 'Invoices'} Ready for Review
              </div>
              <div className="text-xs text-blue-700 dark:text-blue-400">
                Recurring schedules create drafts first so you can review line items before sending to clients.
              </div>
            </div>
          </div>
          <button
            onClick={onNavigateToDraftInvoices}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shrink-0 transition-colors"
          >
            Review Invoices &rarr;
          </button>
        </div>
      )}

      {/* KPI Cards Header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
            Active Retainers
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {activeSchedules.length}{' '}
            <span className="text-xs font-normal text-slate-500">of {schedules.length} total</span>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
            Est. Monthly Revenue (MRR)
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            ${totalMonthlyRun.toFixed(2)}{' '}
            <span className="text-xs font-normal text-slate-500">/ mo</span>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
            Cloudflare Cron Engine
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Active (Daily @ 9:00 AM CST)</span>
          </div>
        </Card>
      </div>

      {/* Main Table / Cards Card */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Repeat className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Recurring Retainers & Subscriptions
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Automated invoice generation for ongoing technical support, managed services, and contracts.
            </p>
          </div>

          {currentUser.role !== 'viewer' && (
            <Button size="sm" onClick={openNewModal} className="shrink-0">
              <Plus className="w-3.5 h-3.5 mr-1" />
              New Recurring Retainer
            </Button>
          )}
        </div>

        {schedules.length === 0 ? (
          <div className="text-center py-12">
            <Repeat className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">No Recurring Retainers</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
              Set up a recurring schedule for clients who pay you on a weekly, monthly, or quarterly retainer.
            </p>
            {currentUser.role !== 'viewer' && (
              <Button size="sm" onClick={openNewModal}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Configure First Retainer
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-3">Retainer Name</th>
                    <th className="py-3 px-3">Client</th>
                    <th className="py-3 px-3">Frequency</th>
                    <th className="py-3 px-3">Next Draft Date</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Amount</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {schedules.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                        {s.profileName}
                      </td>
                      <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                        {s.client?.companyName}
                      </td>
                      <td className="py-3 px-3">
                        <span className="capitalize text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {s.frequency}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400">
                        <div className="font-mono">{s.nextRunDate}</div>
                        {s.lastRunDate && (
                          <div className="text-[10px] text-slate-400">Last: {s.lastRunDate}</div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            s.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {s.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-white">
                        ${s.total.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Run Now Button */}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleRunNow(s)}
                            disabled={runningId === s.id}
                            title="Generate draft invoice immediately for review"
                          >
                            <Play className="w-3.5 h-3.5 mr-1" />
                            {runningId === s.id ? 'Running...' : 'Run Now'}
                          </Button>

                          {/* Pause / Resume */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleToggle(s)}
                            title={s.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
                          >
                            {s.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          </Button>

                          {/* Edit */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(s)}
                            title="Edit schedule details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>

                          {/* Delete (Admin only) */}
                          {currentUser.role === 'admin' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(s)}
                              className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              title="Delete recurring schedule"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="sm:hidden space-y-3">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-white text-sm">{s.profileName}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{s.client?.companyName}</p>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                        s.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {s.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs border-y border-slate-100 dark:border-slate-800/80 py-2">
                    <div>
                      <span className="text-slate-400">Frequency:</span>{' '}
                      <span className="font-medium capitalize text-slate-700 dark:text-slate-300">{s.frequency}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Next Run:</span>{' '}
                      <span className="font-medium font-mono text-slate-700 dark:text-slate-300">{s.nextRunDate}</span>
                    </div>
                    <div className="col-span-2 flex justify-between items-center pt-1">
                      <span className="text-slate-400">Amount per Period:</span>
                      <span className="font-bold text-base text-slate-900 dark:text-white">${s.total.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRunNow(s)}
                      disabled={runningId === s.id}
                      className="text-xs"
                    >
                      <Play className="w-3.5 h-3.5 mr-1" />
                      {runningId === s.id ? 'Running...' : 'Run Draft'}
                    </Button>

                    <Button size="sm" variant="outline" onClick={() => handleToggle(s)}>
                      {s.status === 'active' ? 'Pause' : 'Resume'}
                    </Button>

                    <Button size="sm" variant="outline" onClick={() => openEditModal(s)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Retainer Composer Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-6 my-8 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
              {editingId ? 'Edit Recurring Retainer' : 'Configure Recurring Retainer'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
              Draft invoices will be automatically generated on schedule and an email reminder dispatched to your inbox.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Client
                  </label>
                  <select
                    required
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.companyName} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Retainer Profile Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formProfileName}
                    onChange={(e) => setFormProfileName(e.target.value)}
                    placeholder="e.g. Monthly Managed Network Retainer"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Billing Frequency
                  </label>
                  <select
                    value={formFrequency}
                    onChange={(e) => setFormFrequency(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly (Recommended)</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annually">Annually</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Next Run Date
                  </label>
                  <input
                    type="date"
                    required
                    value={formNextRunDate}
                    onChange={(e) => setFormNextRunDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Line items table */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">
                    Recurring Line Items
                  </span>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                  >
                    + Add Item
                  </button>
                </div>

                <div className="space-y-3">
                  {formItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-2"
                    >
                      <div className="flex gap-2">
                        {catalogItems.length > 0 && (
                          <select
                            onChange={(e) => handleSelectCatalogItem(idx, e.target.value)}
                            className="w-1/3 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                            defaultValue=""
                          >
                            <option value="" disabled>
                              Select Catalog Item...
                            </option>
                            {catalogItems.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name} (${cat.unitPrice})
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          type="text"
                          required
                          value={item.name}
                          onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                          placeholder="Item Name"
                          className="flex-1 px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                        {formItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            className="text-rose-500 hover:text-rose-700 px-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        <input
                          type="number"
                          step="any"
                          required
                          value={item.quantity}
                          onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                          placeholder="Qty"
                          className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => handleItemChange(idx, 'unit', e.target.value)}
                          placeholder="Unit (mo, hrs)"
                          className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                        <input
                          type="number"
                          step="any"
                          required
                          value={item.unitPrice}
                          onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                          placeholder="Price"
                          className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                        <input
                          type="number"
                          step="any"
                          value={item.taxRate}
                          onChange={(e) => handleItemChange(idx, 'taxRate', e.target.value)}
                          placeholder="Tax %"
                          className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Admin Reminder Toggle */}
              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={formSendReminder}
                    onChange={(e) => setFormSendReminder(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Send me an email reminder when this draft invoice is generated</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Saving...' : editingId ? 'Update Retainer' : 'Save Retainer Schedule'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
