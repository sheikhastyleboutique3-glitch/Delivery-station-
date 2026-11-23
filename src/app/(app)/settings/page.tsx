'use client';

import { useEffect, useState } from 'react';
import type { AppSettings } from '@/lib/domain';
import { apiSend, type ApiError } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import { useApp } from '@/components/providers';
import { Button, Card, Checkbox, Field, Input, Loading, PageHeader, Select } from '@/components/ui';

export default function SettingsPage() {
  const { toast } = useApp();
  const { data } = useApi<AppSettings>('/api/settings');
  const [s, setS] = useState<AppSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setS(data);
  }, [data]);

  if (!s) return <Loading />;
  const num = (k: keyof AppSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await apiSend('PUT', '/api/settings', s);
      toast('تم حفظ الإعدادات. أعد تحميل الصفحة لتطبيق التنسيق الجديد.');
    } catch (err) {
      const e = err as ApiError;
      setErrors((e.details as { fields?: Record<string, string> })?.fields ?? {});
      toast(e.messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="الإعدادات" actions={<Button onClick={save} loading={busy}>حفظ</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="المستودع والمرتجعات">
          <div className="space-y-3">
            <Checkbox
              label="المرتجع السليم يعود متاحاً (برتقالي) مباشرة دون فرز"
              checked={s.autoRestockGoodReturns}
              onChange={(v) => setS({ ...s, autoRestockGoodReturns: v })}
            />
            <p className="text-xs text-slate-500">عند الإيقاف (الافتراضي) يذهب المرتجع السليم إلى البنفسجي بانتظار الفرز.</p>
          </div>
        </Card>
        <Card title="التنبيهات">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="أحمر لم يُعالج بعد (ساعة)" error={errors.redAlertHours}>
              <Input dir="ltr" type="number" min={1} value={s.redAlertHours} onChange={num('redAlertHours')} />
            </Field>
            <Field label="عهدة دون تسوية بعد (ساعة)" error={errors.custodyAlertHours}>
              <Input dir="ltr" type="number" min={1} value={s.custodyAlertHours} onChange={num('custodyAlertHours')} />
            </Field>
            <Field label="صرف دون تأكيد بعد (ساعة)" error={errors.pendingAckAlertHours}>
              <Input dir="ltr" type="number" min={1} value={s.pendingAckAlertHours} onChange={num('pendingAckAlertHours')} />
            </Field>
          </div>
        </Card>
        <Card title="العرض والتنسيق">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="اسم الشركة (يظهر في السندات)" error={errors.companyName}>
              <Input value={s.companyName} onChange={(e) => setS({ ...s, companyName: e.target.value })} />
            </Field>
            <Field label="العملة (رمز ISO)" error={errors.currency} hint="مثال: QAR, SAR, AED, KWD, EGP">
              <Input dir="ltr" value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="المنطقة الزمنية" error={errors.timezone} hint="مثال: Asia/Qatar, Asia/Riyadh, Africa/Cairo">
              <Input dir="ltr" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
            </Field>
            <Field label="الأرقام">
              <Select value={s.numerals} onChange={(e) => setS({ ...s, numerals: e.target.value as AppSettings['numerals'] })}>
                <option value="latin">0123456789</option>
                <option value="arabic">٠١٢٣٤٥٦٧٨٩</option>
              </Select>
            </Field>
          </div>
        </Card>
        <Card title="ملصقات الباركود (الافتراضي)">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="النوع">
              <Select value={s.barcodeFormat} onChange={(e) => setS({ ...s, barcodeFormat: e.target.value as AppSettings['barcodeFormat'] })}>
                <option value="CODE128">Code 128</option>
                <option value="EAN13">EAN-13</option>
                <option value="QR">QR</option>
              </Select>
            </Field>
            <Field label="العرض (مم)" error={errors.labelWidthMm}>
              <Input dir="ltr" type="number" value={s.labelWidthMm} onChange={num('labelWidthMm')} />
            </Field>
            <Field label="الارتفاع (مم)" error={errors.labelHeightMm}>
              <Input dir="ltr" type="number" value={s.labelHeightMm} onChange={num('labelHeightMm')} />
            </Field>
          </div>
        </Card>
      </div>
    </>
  );
}
