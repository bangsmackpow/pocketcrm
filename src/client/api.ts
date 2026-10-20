export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  banned?: boolean;
}

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  banned: boolean;
  createdAt: string | number;
  updatedAt: string | number;
}

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  unitPrice: number;
  unit: string;
  defaultTaxRate: number;
  isActive: boolean;
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
  logoUrl?: string | null;
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

export async function signOut(): Promise<void> {
  await apiFetch('/api/auth/sign-out', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// User Management API
export async function fetchUsers(): Promise<ManagedUser[]> {
  const res = await apiFetch<{ users: ManagedUser[] }>('/api/auth/users');
  return res.users || [];
}

export async function createManagedUser(data: {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'member' | 'viewer';
}): Promise<ManagedUser> {
  const res = await apiFetch<{ user: ManagedUser }>('/api/auth/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.user;
}

export async function updateManagedUser(
  id: string,
  data: {
    name?: string;
    email?: string;
    role?: 'admin' | 'member' | 'viewer';
    banned?: boolean;
  }
): Promise<ManagedUser> {
  const res = await apiFetch<{ user: ManagedUser }>(`/api/auth/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return res.user;
}

export async function resetManagedUserPassword(
  id: string,
  newPassword: string
): Promise<void> {
  await apiFetch(`/api/auth/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
}

export async function deleteManagedUser(id: string): Promise<void> {
  await apiFetch(`/api/auth/users/${id}`, {
    method: 'DELETE',
  });
}

// Product & Service Catalog API
export async function fetchCatalogItems(): Promise<CatalogItem[]> {
  const res = await apiFetch<{ items: CatalogItem[] }>('/api/items');
  return res.items || [];
}

export async function createCatalogItem(data: {
  name: string;
  description?: string;
  unitPrice: number;
  unit: string;
  defaultTaxRate?: number;
}): Promise<CatalogItem> {
  const res = await apiFetch<{ item: CatalogItem }>('/api/items', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.item;
}

export async function updateCatalogItem(
  id: string,
  data: Partial<CatalogItem>
): Promise<CatalogItem> {
  const res = await apiFetch<{ item: CatalogItem }>(`/api/items/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return res.item;
}

export async function deleteCatalogItem(id: string): Promise<void> {
  await apiFetch(`/api/items/${id}`, {
    method: 'DELETE',
  });
}

// Logo Upload API
export async function uploadLogo(
  templateId: string,
  imageDataBase64: string,
  filename = 'logo.png'
): Promise<string> {
  const res = await apiFetch<{ logoUrl: string }>(`/api/templates/${templateId}/logo`, {
    method: 'POST',
    body: JSON.stringify({
      imageDataBase64,
      filename,
      contentType: imageDataBase64.startsWith('data:image/svg')
        ? 'image/svg+xml'
        : 'image/png',
    }),
  });
  return res.logoUrl;
}
