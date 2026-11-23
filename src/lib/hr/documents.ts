import { createHash } from 'node:crypto';
import type { Db } from '../db';
import { requireRole, type Actor } from '../actor';
import { writeAudit } from '../audit';
import { Errors } from '../errors';
import { MAX_DOCUMENT_BYTES } from '../domain';
import { documentMetaSchema } from './validation';
import { dbDate } from './util';

/**
 * يتعرف على نوع الملف من محتواه (Magic bytes) وليس من الامتداد أو ما يرسله المتصفح.
 * لا يُقبل SVG أو HTML لأنها قد تحمل سكربتات.
 */
export function sniffMime(buf: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  const b = (i: number) => buf[i];
  if (buf.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b(i) === v)) return 'image/png';
  if (buf.length >= 12 && String.fromCharCode(...buf.slice(0, 4)) === 'RIFF' && String.fromCharCode(...buf.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && String.fromCharCode(...buf.slice(0, 5)) === '%PDF-') return 'application/pdf';
  return null;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** اسم ملف آمن: بلا مسارات أو رموز تحكم، ومع الامتداد الصحيح حسب النوع الحقيقي */
export function safeFileName(name: string, mime: string): string {
  const base = (name.split(/[\\/]/).pop() ?? 'file')
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .trim()
    .slice(0, 100);
  return `${base || 'document'}.${EXT[mime]}`;
}

export async function uploadDocument(db: Db, actor: Actor, employeeId: string, form: FormData) {
  requireRole(actor, ['ADMIN']);
  const file = form.get('file');
  if (!file || typeof file === 'string') throw Errors.validation('اختر ملفاً للرفع');
  if (file.size === 0) throw Errors.validation('الملف فارغ');
  if (file.size > MAX_DOCUMENT_BYTES) throw Errors.validation(`حجم الملف أكبر من ${MAX_DOCUMENT_BYTES / 1024 / 1024} ميغابايت`);
  const meta = documentMetaSchema.parse({
    type: form.get('type'),
    title: form.get('title') || null,
    docNumber: form.get('docNumber') || null,
    issueDate: form.get('issueDate') || null,
    expiryDate: form.get('expiryDate') || null,
  });
  if (meta.issueDate && meta.expiryDate && meta.expiryDate < meta.issueDate) throw Errors.validation('تاريخ الانتهاء قبل تاريخ الإصدار');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) throw Errors.validation('نوع الملف غير مسموح. المسموح: صور JPG أو PNG أو WEBP، أو ملفات PDF');

  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw Errors.notFound('الموظف');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return db.$transaction(async (tx) => {
    const doc = await tx.employeeDocument.create({
      data: {
        employeeId,
        type: meta.type,
        title: meta.title,
        docNumber: meta.docNumber,
        issueDate: meta.issueDate ? dbDate(meta.issueDate) : null,
        expiryDate: meta.expiryDate ? dbDate(meta.expiryDate) : null,
        fileName: safeFileName(file.name, mime),
        mimeType: mime,
        sizeBytes: bytes.length,
        sha256,
        uploadedById: actor.id,
        file: { create: { data: Buffer.from(bytes) } },
      },
    });
    // وثيقة هوية أو رخصة بتاريخ انتهاء: نحدّث تاريخ الانتهاء في الملف الوظيفي حتى تعمل التنبيهات
    if (meta.expiryDate && (meta.type === 'ID_FRONT' || meta.type === 'ID_BACK')) {
      await tx.employee.update({ where: { id: employeeId }, data: { idExpiryDate: dbDate(meta.expiryDate) } });
    }
    if (meta.expiryDate && meta.type === 'DRIVING_LICENSE') {
      await tx.employee.update({
        where: { id: employeeId },
        data: { drivingLicenseExpiry: dbDate(meta.expiryDate), ...(meta.docNumber ? { drivingLicenseNumber: meta.docNumber } : {}) },
      });
    }
    const { ...metaOnly } = doc;
    await writeAudit(tx, actor, { action: 'employee.document.upload', entityType: 'employee', entityId: employeeId, after: metaOnly });
    return doc;
  });
}

export async function getDocumentFile(db: Db, actor: Actor, documentId: string) {
  requireRole(actor, ['ADMIN']);
  const doc = await db.employeeDocument.findUnique({ where: { id: documentId }, include: { file: true } });
  if (!doc || !doc.file) throw Errors.notFound('الوثيقة');
  return doc;
}

export async function deleteDocument(db: Db, actor: Actor, documentId: string) {
  requireRole(actor, ['ADMIN']);
  return db.$transaction(async (tx) => {
    const doc = await tx.employeeDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw Errors.notFound('الوثيقة');
    await tx.employeeDocument.delete({ where: { id: documentId } });
    await writeAudit(tx, actor, { action: 'employee.document.delete', entityType: 'employee', entityId: doc.employeeId, before: doc });
    return { deleted: true };
  });
}
