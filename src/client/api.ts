export interface PersonaUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  banned?: boolean;
}

export interface ClientDto {
  id: string;
  code: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  website?: string;
  taxIdentifier?: string;
  paymentTermsDays: number;
  currency: string;
  billingAddress: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
  };
  notes?: string;
  isActive: boolean;
}

export interface DocumentDto {
  id: string;
  documentNumber: string;
  type: 'invoice' | 'estimate';
  status: string;
  clientId: string;
  templateId?: string;
  convertedToDocumentId?: string | null;
  sourceEstimateId?: string | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  notes?: string;
  terms?: string;
  pdfR2Key?: string | null;
  client?: {
    id: string;
    code: string;
    companyName: string;
    contactName: string;
    email: string;
  };
}

export interface TemplateDto {
  id: string;
  name: string;
  isDefault: boolean;
  logoPlacement: 'left' | 'center' | 'right';
  companyHeaderText: string;
  paymentInstructions: string;
  footerLegalClause: string;
  styles: {
    primaryColor: string;
    accentColor: string;
    fontFamily: string;
    headerBg: string;
    tableBorderColor: string;
    customCssVars: Record<string, string>;
  };
}

let activePersonaId = 'usr_admin_01';

export function setActivePersonaId(id: string) {
  activePersonaId = id;
}

export function getActivePersonaId() {
  return activePersonaId;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('x-demo-user-id', activePersonaId);

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMessage =
      (data as { message?: string; error?: string })?.message ||
      (data as { error?: string })?.error ||
      `Request failed (${res.status})`;
    throw new Error(errMessage);
  }
  return data as T;
}
