'use client';

import { useState } from 'react';
import { DRIVER_STATUSES, DRIVER_STATUS_LABELS } from '@/lib/domain';
import { apiSend, type ApiError } from '@/lib/client/api';
import type { Driver } from '@/lib/client/types';
import { PointSelect } from './pickers';
import { useApp } from './providers';
import { Button, Field, Input, Modal, Select, Textarea } from './ui';

type Form = {
  fullName: string;
  phone: string;
  altPhone: string;
  address: string;
  nationalId: string;
  vehicleType: string;
  vehiclePlate: string;
  deliveryPointId: string;
  status: Driver['status'];
  notes: string;
};

export function DriverFormModal({ driver, open, onClose, onSaved }: { driver: Driver | null; open: boolean; onClose: () => void; onSaved: (d: Driver) => void }) {
  const { toast } = useApp();
  const [form, setForm] = useState<Form>(() => ({
    fullName: driver?.fullName ?? '',
    phone: driver?.phone ?? '',
    altPhone: driver?.altPhone ?? '',
    address: driver?.address ?? '',
    nationalId: driver?.nationalId ?? '',
    vehicleType: driver?.vehicleType ?? '',
    vehiclePlate: driver?.vehiclePlate ?? '',
    deliveryPointId: driver?.deliveryPointId ?? '',
    status: driver?.status ?? 'AVAILABLE',
    notes: driver?.notes ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const d = driver ? await apiSend<Driver>('PATCH', `/api/drivers/${driver.id}`, form) : await apiSend<Driver>('POST', '/api/drivers', form);
      toast(driver ? 'تم حفظ التعديلات' : 'تمت إضافة السائق');
      onSaved(d);
    } catch (err) {
      const e = err as ApiError;
      setErrors((e.details as { fields?: Record<string, string> })?.fields ?? {});
      toast(e.messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={driver ? `تعديل: ${driver.fullName}` : 'إضافة سائق'}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} loading={busy}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الاسم الكامل" error={errors.fullName}>
          <Input value={form.fullName} onChange={set('fullName')} />
        </Field>
        <Field label="رقم الهوية" error={errors.nationalId}>
          <Input dir="ltr" value={form.nationalId} onChange={set('nationalId')} />
        </Field>
        <Field label="رقم الهاتف" error={errors.phone}>
          <Input dir="ltr" inputMode="tel" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="رقم بديل" error={errors.altPhone}>
          <Input dir="ltr" inputMode="tel" value={form.altPhone} onChange={set('altPhone')} />
        </Field>
        <Field label="العنوان التفصيلي" className="sm:col-span-2" error={errors.address}>
          <Input value={form.address} onChange={set('address')} />
        </Field>
        <Field label="نوع المركبة">
          <Input value={form.vehicleType} onChange={set('vehicleType')} placeholder="دراجة نارية، سيارة فان…" />
        </Field>
        <Field label="رقم اللوحة">
          <Input dir="ltr" value={form.vehiclePlate} onChange={set('vehiclePlate')} />
        </Field>
        <PointSelect value={form.deliveryPointId} onChange={(v) => setForm((f) => ({ ...f, deliveryPointId: v }))} label="نقطة الدليفري التابع لها" />
        <Field label="الحالة">
          <Select value={form.status} onChange={set('status')}>
            {DRIVER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DRIVER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ملاحظات" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  );
}
