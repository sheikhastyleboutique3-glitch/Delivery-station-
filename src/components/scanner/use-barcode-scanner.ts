'use client';

import { useEffect, useRef } from 'react';
import type { ScanSource } from '@/lib/domain';
import { latinFromKeyEvent } from './keymap';

interface Options {
  enabled?: boolean;
  /** أقل طول للباركود */
  minLength?: number;
  /** أقصى فاصل زمني بين حرفين (ملّي ثانية). الإنسان أبطأ من 50ms */
  maxIntervalMs?: number;
  /** بعض السكانرات لا ترسل Enter: نعتبر الإدخال منتهياً بعد هذا الصمت */
  idleSubmitMs?: number;
}

/**
 * يلتقط إدخال السكانر الخارجي (USB / Bluetooth) على مستوى الصفحة كلها،
 * حتى لو لم يكن أي حقل مُركَّزاً. يتجاهل الكتابة اليدوية العادية لأنها أبطأ،
 * ولا يتدخل عند الكتابة داخل حقول أخرى (ملاحظات، أسماء...).
 * الحقل الذي يحمل data-scan-capture يعالج المسح بنفسه.
 */
export function useBarcodeScanner(onScan: (code: string, source: ScanSource) => void, opts: Options = {}) {
  const { enabled = true, minLength = 4, maxIntervalMs = 50, idleSubmitMs = 120 } = opts;
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buf = '';
    let last = 0;
    let idle: ReturnType<typeof setTimeout> | null = null;

    const emit = () => {
      if (buf.length >= minLength) cb.current(buf, 'EXTERNAL_SCANNER');
      buf = '';
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const editable = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (editable) return; // الحقول تعالج الإدخال بنفسها

      const now = performance.now();
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buf.length >= minLength && now - last < maxIntervalMs * 4) {
          e.preventDefault();
          if (idle) clearTimeout(idle);
          emit();
        }
        buf = '';
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ch = latinFromKeyEvent(e);
      if (!ch) return;
      if (now - last > maxIntervalMs) buf = '';
      buf += ch;
      last = now;
      if (buf.length > 1) e.preventDefault();
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => {
        if (buf.length >= 8) emit();
        else buf = '';
      }, idleSubmitMs);
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (idle) clearTimeout(idle);
    };
  }, [enabled, minLength, maxIntervalMs, idleSubmitMs]);
}

/** نغمة تأكيد قصيرة عند المسح (بدون ملفات صوتية) */
export function beep(ok = true) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1320 : 220;
    o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    o.onended = () => ctx.close();
  } catch {
    /* الصوت اختياري */
  }
  navigator.vibrate?.(ok ? 30 : [60, 40, 60]);
}
