'use client';

import { useEffect, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { Button, Modal, Select } from '../ui';

const READER_ID = 'rasd-camera-reader';

function cameraError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err);
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'الكاميرا تعمل فقط عبر HTTPS (أو localhost). افتح الموقع برابط https://';
  }
  if (/NotAllowed|Permission/i.test(msg)) return 'تم رفض إذن الكاميرا. اسمح بالوصول للكاميرا من إعدادات المتصفح ثم أعد المحاولة';
  if (/NotFound|Requested device not found|no camera/i.test(msg)) return 'لا توجد كاميرا متاحة على هذا الجهاز';
  if (/NotReadable|in use/i.test(msg)) return 'الكاميرا مستخدمة من تطبيق آخر. أغلقه ثم أعد المحاولة';
  return 'تعذر تشغيل الكاميرا: ' + msg;
}

/**
 * مسح الباركود و QR بكاميرا الجوال عبر html5-qrcode.
 * يبقى يعمل بعد كل مسح (لمسح عدة منتجات متتالية) ويتجاهل تكرار نفس الكود خلال 1.5 ثانية.
 */
export function CameraScanner({ open, onClose, onScan }: { open: boolean; onClose: () => void; onScan: (code: string) => void }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const [starting, setStarting] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setError(null);
      setStarting(true);
      try {
        if (!window.isSecureContext) throw new Error('insecure');
        const mod = await import('html5-qrcode');
        if (cancelled) return;
        const F = mod.Html5QrcodeSupportedFormats;
        const scanner = new mod.Html5Qrcode(READER_ID, {
          verbose: false,
          formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.DATA_MATRIX],
        });
        scannerRef.current = scanner;
        try {
          const list = await mod.Html5Qrcode.getCameras();
          if (!cancelled) setCameras(list.map((c, i) => ({ id: c.id, label: c.label || `كاميرا ${i + 1}` })));
        } catch {
          /* قد لا تتوفر الأسماء قبل الإذن */
        }
        await scanner.start(
          cameraId ? { deviceId: { exact: cameraId } } : { facingMode: 'environment' },
          { fps: 12, qrbox: (w, h) => ({ width: Math.min(300, w * 0.85), height: Math.min(180, h * 0.6) }), aspectRatio: 1.333 },
          (text) => {
            const now = Date.now();
            if (text === lastRef.current.code && now - lastRef.current.at < 1500) return;
            lastRef.current = { code: text, at: now };
            setLastCode(text);
            onScanRef.current(text);
          },
          () => undefined,
        );
        if (cancelled) {
          await scanner.stop().catch(() => undefined);
          return;
        }
        try {
          const t = scanner.getRunningTrackCameraCapabilities().torchFeature();
          setTorch({ supported: t.isSupported(), on: false });
        } catch {
          setTorch({ supported: false, on: false });
        }
      } catch (err) {
        if (!cancelled) setError(cameraError(err));
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        s.stop()
          .catch(() => undefined)
          .finally(() => {
            try {
              s.clear();
            } catch {
              /* noop */
            }
          });
      }
    };
  }, [open, cameraId]);

  async function toggleTorch() {
    try {
      const t = scannerRef.current?.getRunningTrackCameraCapabilities().torchFeature();
      if (!t) return;
      await t.apply(!torch.on);
      setTorch((s) => ({ ...s, on: !s.on }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="مسح بالكاميرا"
      footer={
        <>
          {torch.supported && (
            <Button variant="secondary" onClick={toggleTorch}>
              {torch.on ? 'إطفاء الفلاش' : 'تشغيل الفلاش'}
            </Button>
          )}
          <Button onClick={onClose}>تم</Button>
        </>
      }
    >
      <div className="space-y-3">
        {cameras.length > 1 && (
          <Select value={cameraId ?? ''} onChange={(e) => setCameraId(e.target.value || null)} aria-label="اختر الكاميرا">
            <option value="">الكاميرا الخلفية (تلقائي)</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
        <div id={READER_ID} className="min-h-56 overflow-hidden rounded-xl bg-slate-900" />
        {starting && <p className="text-center text-sm text-slate-500">جارِ تشغيل الكاميرا…</p>}
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}
        {lastCode && (
          <p className="text-center text-sm">
            آخر كود: <span className="ltr font-mono font-bold">{lastCode}</span>
          </p>
        )}
        <p className="text-center text-xs text-slate-500">وجّه الكاميرا نحو الباركود. يمكنك مسح عدة منتجات متتالية دون إغلاق النافذة.</p>
      </div>
    </Modal>
  );
}
