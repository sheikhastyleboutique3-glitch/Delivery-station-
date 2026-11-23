'use client';

import { useRef, useState } from 'react';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, MAX_DOCUMENT_BYTES, type DocumentType } from '@/lib/domain';
import { apiSend, apiUpload, type ApiError } from '@/lib/client/api';
import type { EmployeeDoc } from '@/lib/client/types';
import { Icon } from '../icons';
import { useApp } from '../providers';
import { Badge, Button, EmptyState, Field, Input, Modal, Select, cx } from '../ui';

/**
 * تصغير صور الهاتف قبل الرفع (صورة كاميرا 4-8 ميغابايت ← نحو 300 كيلوبايت)
 * مع الحفاظ على وضوح بطاقة الهوية. ملفات PDF تُرفع كما هي.
 */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1800;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

function expiryBadge(expiry: string | null, today: string, alertDays: number) {
  if (!expiry) return null;
  const left = Math.round((Date.parse(expiry.slice(0, 10)) - Date.parse(today)) / 86_400_000);
  if (left < 0) return <Badge className="border-red-300 bg-red-100 text-red-900">منتهية منذ {-left} يوم</Badge>;
  if (left <= alertDays) return <Badge className="border-amber-300 bg-amber-100 text-amber-900">تنتهي بعد {left} يوم</Badge>;
  return <Badge className="border-green-300 bg-green-50 text-green-900">سارية</Badge>;
}

export function DocumentsPanel({ employeeId, documents, onChanged }: { employeeId: string; documents: EmployeeDoc[]; onChanged: () => void }) {
  const { f, toast, settings } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<EmployeeDoc | null>(null);
  const [meta, setMeta] = useState<{ type: DocumentType; title: string; docNumber: string; issueDate: string; expiryDate: string }>({
    type: 'ID_FRONT',
    title: '',
    docNumber: '',
    issueDate: '',
    expiryDate: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(f0: File | undefined) {
    if (!f0) return;
    const ready = await compressImage(f0);
    if (ready.size > MAX_DOCUMENT_BYTES) {
      toast(`الملف أكبر من ${MAX_DOCUMENT_BYTES / 1024 / 1024} ميغابايت بعد الضغط`, 'error');
      return;
    }
    setFile(ready);
    setLocalPreview(ready.type.startsWith('image/') ? URL.createObjectURL(ready) : null);
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      for (const [k, v] of Object.entries(meta)) if (v) form.set(k, v);
      await apiUpload(`/api/employees/${employeeId}/documents`, form);
      toast('تم رفع الوثيقة');
      setOpen(false);
      setFile(null);
      setLocalPreview(null);
      setMeta({ type: 'ID_FRONT', title: '', docNumber: '', issueDate: '', expiryDate: '' });
      onChanged();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function remove(d: EmployeeDoc) {
    if (!window.confirm(`حذف "${d.title || DOCUMENT_TYPE_LABELS[d.type]}" نهائياً؟`)) return;
    try {
      await apiSend('DELETE', `/api/documents/${d.id}`);
      toast('تم حذف الوثيقة');
      setPreview(null);
      onChanged();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">صور البطاقة، الصورة الشخصية، الرخصة، العقد، أو أي وثيقة. المسموح: JPG وPNG وWEBP وPDF حتى 5 ميغابايت.</p>
        <Button onClick={() => setOpen(true)}>
          <Icon name="upload" /> رفع وثيقة
        </Button>
      </div>

      {documents.length === 0 ? (
        <EmptyState title="لا توجد وثائق بعد" hint="ابدأ بصورة بطاقة التعريف (الوجه والخلف)" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {documents.map((d) => {
            const isImage = d.mimeType.startsWith('image/');
            return (
              <li key={d.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <button type="button" onClick={() => setPreview(d)} className="block h-40 w-full bg-slate-100" aria-label={`معاينة ${d.title || DOCUMENT_TYPE_LABELS[d.type]}`}>
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/documents/${d.id}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                      <Icon name="file" className="h-10 w-10" /> PDF
                    </span>
                  )}
                </button>
                <div className="space-y-1 p-3 text-sm">
                  <p className="font-bold">{d.title || DOCUMENT_TYPE_LABELS[d.type]}</p>
                  <p className="text-xs text-slate-500">
                    {DOCUMENT_TYPE_LABELS[d.type]}
                    {d.docNumber ? <> · <span className="ltr">{d.docNumber}</span></> : null}
                  </p>
                  {d.expiryDate && (
                    <p className="flex flex-wrap items-center gap-2 text-xs">
                      تنتهي: {f.ymd(d.expiryDate)} {expiryBadge(d.expiryDate, today, settings.documentExpiryAlertDays)}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-400">
                    {(d.sizeBytes / 1024).toFixed(0)} KB · رُفعت {f.since(d.createdAt)} {d.uploadedBy ? `بواسطة ${d.uploadedBy.name}` : ''}
                  </p>
                  <div className="flex gap-1 pt-1">
                    <Button size="sm" variant="secondary" onClick={() => setPreview(d)}>
                      <Icon name="eye" className="h-4 w-4" /> معاينة
                    </Button>
                    <a href={`/api/documents/${d.id}?download=1`} className="inline-flex min-h-9 items-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-semibold">
                      <Icon name="download" className="h-4 w-4" /> تحميل
                    </a>
                    <Button size="sm" variant="ghost" onClick={() => remove(d)} aria-label="حذف">
                      <Icon name="trash" className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="رفع وثيقة أو صورة"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={upload} loading={uploading} disabled={!file}>
              رفع
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="نوع الوثيقة">
            <Select value={meta.type} onChange={(e) => setMeta({ ...meta, type: e.target.value as DocumentType })}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div
            className={cx('flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center', file ? 'border-green-400 bg-green-50' : 'border-slate-300')}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files[0]);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          >
            {localPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={localPreview} alt="معاينة" className="max-h-48 rounded-lg" />
            ) : (
              <Icon name="upload" className="h-8 w-8 text-slate-400" />
            )}
            <p className="text-sm font-semibold">{file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : 'اضغط لالتقاط صورة أو اختيار ملف، أو اسحبه هنا'}</p>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
          <Field label="عنوان (اختياري)">
            <Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="رقم الوثيقة">
              <Input dir="ltr" value={meta.docNumber} onChange={(e) => setMeta({ ...meta, docNumber: e.target.value })} />
            </Field>
            <Field label="تاريخ الإصدار">
              <Input type="date" value={meta.issueDate} onChange={(e) => setMeta({ ...meta, issueDate: e.target.value })} />
            </Field>
            <Field label="تاريخ الانتهاء">
              <Input type="date" value={meta.expiryDate} onChange={(e) => setMeta({ ...meta, expiryDate: e.target.value })} />
            </Field>
          </div>
          {(meta.type === 'ID_FRONT' || meta.type === 'ID_BACK' || meta.type === 'DRIVING_LICENSE') && (
            <p className="text-xs text-slate-500">تاريخ الانتهاء يُحدَّث تلقائياً في ملف الموظف ويُستخدم في تنبيهات انتهاء الصلاحية.</p>
          )}
        </div>
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? preview.title || DOCUMENT_TYPE_LABELS[preview.type] : ''} wide>
        {preview &&
          (preview.mimeType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/documents/${preview.id}`} alt="" className="mx-auto max-h-[70vh] rounded-lg" />
          ) : (
            <div className="space-y-3 text-center">
              <Icon name="file" className="mx-auto h-16 w-16 text-slate-400" />
              <p>{preview.fileName}</p>
              <a href={`/api/documents/${preview.id}`} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-700 underline">
                فتح ملف PDF في نافذة جديدة
              </a>
            </div>
          ))}
      </Modal>
    </div>
  );
}
