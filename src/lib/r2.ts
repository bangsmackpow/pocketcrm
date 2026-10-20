/**
 * Cloudflare R2 Bucket storage adapter for:
 * - Generated Invoice & Estimate PDFs (`pdfs/{type}/{documentNumber}.pdf`)
 * - Document Attachments (`attachments/{documentId}/{filename}`)
 * - Imported CSV Backups (`imports/{timestamp}_{filename}.csv`)
 */

export interface StoredR2ObjectMeta {
  key: string;
  size: number;
  etag: string;
  contentType: string;
  uploadedAt: string;
}

export async function putDocumentPdf(
  bucket: R2Bucket,
  documentType: 'invoice' | 'estimate',
  documentNumber: string,
  content: Uint8Array | ArrayBuffer | string,
  contentType = 'application/pdf'
): Promise<StoredR2ObjectMeta> {
  const safeNum = documentNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  const key = `pdfs/${documentType}s/${safeNum}.pdf`;
  const uploadedAt = new Date().toISOString();

  const obj = await bucket.put(key, content, {
    httpMetadata: {
      contentType,
      contentDisposition: `inline; filename="${safeNum}.pdf"`,
    },
    customMetadata: {
      documentType,
      documentNumber,
      uploadedAt,
    },
  });

  return {
    key,
    size: obj?.size ?? (typeof content === 'string' ? content.length : content.byteLength),
    etag: obj?.etag ?? 'local-etag',
    contentType,
    uploadedAt,
  };
}

export async function putDocumentAttachment(
  bucket: R2Bucket,
  documentId: string,
  filename: string,
  content: ArrayBuffer | Uint8Array | ReadableStream,
  contentType: string
): Promise<StoredR2ObjectMeta> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `attachments/${documentId}/${Date.now()}_${safeName}`;
  const uploadedAt = new Date().toISOString();

  const obj = await bucket.put(key, content, {
    httpMetadata: {
      contentType,
      contentDisposition: `attachment; filename="${safeName}"`,
    },
    customMetadata: {
      documentId,
      originalFilename: filename,
      uploadedAt,
    },
  });

  return {
    key,
    size: obj?.size ?? 0,
    etag: obj?.etag ?? 'local-etag',
    contentType,
    uploadedAt,
  };
}

export async function putCsvImportBackup(
  bucket: R2Bucket,
  rawCsv: string,
  actorEmail?: string
): Promise<StoredR2ObjectMeta> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `imports/csv_import_${timestamp}.csv`;
  const uploadedAt = new Date().toISOString();

  const obj = await bucket.put(key, rawCsv, {
    httpMetadata: {
      contentType: 'text/csv; charset=utf-8',
    },
    customMetadata: {
      actorEmail: actorEmail ?? 'unknown',
      uploadedAt,
    },
  });

  return {
    key,
    size: obj?.size ?? rawCsv.length,
    etag: obj?.etag ?? 'local-etag',
    contentType: 'text/csv',
    uploadedAt,
  };
}

export async function getR2Object(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deleteR2Object(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}
