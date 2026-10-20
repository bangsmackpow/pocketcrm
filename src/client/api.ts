export interface AuthUser {
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

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

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

export async function signInEmail(email: string, password: string): Promise<void> {
  await apiFetch('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function signUpEmail(
  name: string,
  email: string,
  password: string,
  role = 'admin'
): Promise<void> {
  await apiFetch('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, role }),
  });
}

export async function signOut(): Promise<void> {
  await apiFetch('/api/auth/sign-out', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
