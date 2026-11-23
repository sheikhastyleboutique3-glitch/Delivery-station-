'use client';

import { useCallback, useRef, useState } from 'react';
import type { ScanSource } from '@/lib/domain';
import { apiGet, qs } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import { Button, Input } from '../ui';
import { Icon } from '../icons';
import { CameraScanner } from './camera-scanner';
import { beep, useBarcodeScanner } from './use-barcode-scanner';
import { latinFromKeyEvent, normalizeCode } from './keymap';

export interface LookupProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  category: string;
  price: string;
  cost: string | null;
  trackUnits: boolean;
  isArchived: boolean;
}

export type LookupResult =
  | { found: false; code: string }
  | {
      found: true;
      code: string;
      product: LookupProduct;
      unit: { serial: string; color: string | null; deliveryPointId: string | null; driverId: string | null } | null;
      balances: { color: string; quantity: number; deliveryPointId: string }[];
    };

/**
 * مربع المسح الموحد: كاميرا + سكانر خارجي + إدخال يدوي + بحث بالاسم.
 * يُستخدم في الإدخال والصرف والإرجاع والتحويل والفرز.
 */
export function ScanBox({
  onResult,
  onNotFound,
  placeholder = 'امسح الباركود أو اكتب الاسم / SKU',
  disabled,
}: {
  onResult: (r: Extract<LookupResult, { found: true }>, source: ScanSource) => void;
  onNotFound?: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timing = useRef<{ first: number; last: number; count: number }>({ first: 0, last: 0, count: 0 });
  const prevKey = useRef<{ key: string; latin: string | null }>({ key: '', latin: null });
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebounce(value.trim(), 300);
  const suggestUrl = debounced.length >= 2 && !busy ? `/api/products${qs({ q: debounced, pageSize: 8 })}` : null;
  const { data: suggestions } = useApi<{ items: LookupProduct[] }>(suggestUrl);

  const lookup = useCallback(
    async (raw: string, source: ScanSource) => {
      const code = normalizeCode(raw);
      if (!code) return;
      setBusy(true);
      setMsg(null);
      try {
        const r = await apiGet<LookupResult>(`/api/lookup${qs({ code })}`);
        if (r.found) {
          beep(true);
          onResult(r, source);
          setValue('');
        } else {
          beep(false);
          setMsg(`لا يوجد منتج بهذا الكود: ${code}`);
          onNotFound?.(code);
        }
      } catch (err) {
        beep(false);
        setMsg((err as { messageAr?: string }).messageAr ?? 'تعذر البحث');
      } finally {
        setBusy(false);
      }
    },
    [onResult, onNotFound],
  );

  // السكانر الخارجي عندما لا يكون أي حقل مُركَّزاً
  useBarcodeScanner((code, source) => lookup(code, source), { enabled: !disabled && !camera });

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const now = performance.now();
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = timing.current;
      const fast = t.count >= 4 && (t.last - t.first) / Math.max(1, t.count - 1) < 50;
      timing.current = { first: 0, last: 0, count: 0 };
      lookup(value, fast ? 'EXTERNAL_SCANNER' : 'MANUAL');
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const t = timing.current;
      if (t.count === 0 || now - t.last > 300) timing.current = { first: now, last: now, count: 1 };
      else timing.current = { first: t.first, last: now, count: t.count + 1 };
      // السكانر مع لوحة مفاتيح عربية: حوّل الحرف إلى مقابله اللاتيني
      const fastTyping = t.count > 0 && now - t.last < 50;
      const prev = prevKey.current;
      prevKey.current = { key: e.key, latin: latinFromKeyEvent(e) };
      if (fastTyping && !/^[\x20-\x7E]$/.test(e.key)) {
        const latin = latinFromKeyEvent(e);
        if (latin) {
          e.preventDefault();
          setValue((v) => {
            // الحرف الأول من المسح دخل قبل أن نعرف أنه سكانر: صحّحه أيضاً
            const fixed = prev.latin && prev.key && !/^[\x20-\x7E]$/.test(prev.key) && v.endsWith(prev.key) ? v.slice(0, -prev.key.length) + prev.latin : v;
            return fixed + latin;
          });
          prevKey.current = { key: latin, latin };
        }
      }
    }
  }

  return (
    <div className="no-print">
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            data-scan-capture="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            enterKeyHint="search"
            aria-label="الباركود أو اسم المنتج"
            className="pe-24 text-lg"
          />
          <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center gap-1 text-[11px] font-bold text-green-700" title="السكانر الخارجي جاهز">
            <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden /> سكانر
          </span>
          {suggestions && suggestions.items.length > 0 && value.trim().length >= 2 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg" role="listbox">
              {suggestions.items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-start hover:bg-slate-50"
                    onClick={() => {
                      setValue('');
                      lookup(p.barcode, 'MANUAL');
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="font-semibold">{p.name}</span>
                    <span className="ltr font-mono text-xs text-slate-500">{p.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="button" variant="secondary" onClick={() => setCamera(true)} disabled={disabled} aria-label="مسح بالكاميرا" className="shrink-0">
          <Icon name="camera" /> <span className="hidden sm:inline">كاميرا</span>
        </Button>
        <Button type="button" onClick={() => lookup(value, 'MANUAL')} loading={busy} disabled={disabled || !value.trim()} className="shrink-0">
          إضافة
        </Button>
      </div>
      {msg && <p className="mt-2 text-sm font-semibold text-red-700">{msg}</p>}
      <CameraScanner open={camera} onClose={() => setCamera(false)} onScan={(code) => lookup(code, 'CAMERA')} />
    </div>
  );
}
