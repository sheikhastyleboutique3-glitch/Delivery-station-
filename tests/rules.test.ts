import { describe, expect, it } from 'vitest';
import { COLORS, MOVEMENT_TYPES, TRANSITIONS, ean13CheckDigit, findTransition, isAllowedTransition, isValidEan13 } from '@/lib/domain';
import { latinFromKeyEvent, normalizeCode } from '@/components/scanner/keymap';
import { toCsv } from '@/lib/services/reports';
import { canonicalJson } from '@/lib/audit';

describe('مصفوفة الانتقالات', () => {
  it('تسمح بالمسارات الأساسية بالأدوار الصحيحة', () => {
    expect(isAllowedTransition('DISPATCH', 'ORANGE', 'BLUE', 'WAREHOUSE')).toBe(true);
    expect(isAllowedTransition('DELIVERED', 'BLUE', 'GREEN', 'DRIVER')).toBe(true);
    expect(isAllowedTransition('RETURN_GOOD', 'BLUE', 'PURPLE', 'HUB_MANAGER')).toBe(true);
    expect(isAllowedTransition('RETURN_GOOD', 'BLUE', 'ORANGE', 'WAREHOUSE')).toBe(true);
    expect(isAllowedTransition('RETURN_DAMAGED', 'BLUE', 'RED', 'WAREHOUSE')).toBe(true);
    expect(isAllowedTransition('SORT_TO_AVAILABLE', 'PURPLE', 'ORANGE', 'WAREHOUSE')).toBe(true);
    expect(isAllowedTransition('CUSTOMER_RETURN', 'GREEN', 'PURPLE', 'HUB_MANAGER')).toBe(true);
  });

  it('ترفض الانتقالات غير المدرجة', () => {
    expect(findTransition('DISPATCH', 'PURPLE', 'BLUE')).toBeNull();
    expect(findTransition('DELIVERED', 'ORANGE', 'GREEN')).toBeNull();
    expect(findTransition('RETURN_GOOD', 'GREEN', 'ORANGE')).toBeNull();
    expect(findTransition('SORT_TO_AVAILABLE', 'RED', 'ORANGE')).toBeNull();
  });

  it('معالجة الأحمر والشطب للمدير فقط', () => {
    expect(isAllowedTransition('RESOLVE_RED', 'RED', 'ORANGE', 'ADMIN')).toBe(true);
    expect(isAllowedTransition('RESOLVE_RED', 'RED', 'ORANGE', 'WAREHOUSE')).toBe(false);
    expect(isAllowedTransition('WRITE_OFF', 'RED', null, 'HUB_MANAGER')).toBe(false);
  });

  it('السائق لا يصرف ولا يرجع', () => {
    for (const t of TRANSITIONS) {
      if (t.type !== 'DELIVERED') expect(t.roles).not.toContain('DRIVER');
    }
  });

  it('التعديل الاستثنائي: مدير فقط، لونان مختلفان، لا يمس الأزرق', () => {
    expect(isAllowedTransition('STATUS_CHANGE', 'RED', 'PURPLE', 'ADMIN')).toBe(true);
    expect(isAllowedTransition('STATUS_CHANGE', 'RED', 'PURPLE', 'WAREHOUSE')).toBe(false);
    expect(findTransition('STATUS_CHANGE', 'ORANGE', 'BLUE')).toBeNull();
    expect(findTransition('STATUS_CHANGE', 'BLUE', 'RED')).toBeNull();
    expect(findTransition('STATUS_CHANGE', 'RED', 'RED')).toBeNull();
  });

  it('كل انتقال يستخدم ألواناً وأنواعاً معرّفة، والأسباب إلزامية للأحمر والشطب', () => {
    for (const t of TRANSITIONS) {
      expect(MOVEMENT_TYPES).toContain(t.type);
      if (t.from) expect(COLORS).toContain(t.from);
      if (t.to) expect(COLORS).toContain(t.to);
      if (t.to === 'RED' || t.type === 'WRITE_OFF' || t.type === 'RESOLVE_RED') expect(t.reasonRequired).toBe(true);
    }
  });
});

describe('الباركود', () => {
  it('يحسب خانة تحقق EAN-13', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931 مثال قياسي
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
  });

  it('يحوّل إدخال السكانر مع لوحة مفاتيح عربية إلى أحرف لاتينية', () => {
    expect(latinFromKeyEvent({ key: 'ش', code: 'KeyA', shiftKey: false })).toBe('a');
    expect(latinFromKeyEvent({ key: 'ش', code: 'KeyA', shiftKey: true })).toBe('A');
    expect(latinFromKeyEvent({ key: '٣', code: 'Digit3', shiftKey: false })).toBe('3');
    expect(latinFromKeyEvent({ key: '7', code: 'Digit7', shiftKey: false })).toBe('7');
    expect(latinFromKeyEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: true })).toBeNull();
    expect(normalizeCode(' ٢٠٠١٢٣ ')).toBe('200123');
  });
});

describe('التصدير', () => {
  it('CSV يبدأ بـ BOM ويهرب الفواصل ويمنع حقن الصيغ', () => {
    const csv = toCsv({
      title: 't',
      columns: [
        { key: 'a', label: 'الاسم' },
        { key: 'b', label: 'ملاحظة' },
        { key: 'c', label: 'رقم' },
      ],
      rows: [{ a: 'منتج، أحمر', b: '=HYPERLINK("x")', c: -5 }],
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('الاسم,ملاحظة,رقم');
    expect(csv).toContain('منتج، أحمر');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(',-5');
  });

  it('JSON ثابت الترتيب للتجزئة', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });
});
