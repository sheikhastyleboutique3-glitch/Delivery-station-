/**
 * السكانر الخارجي يعمل كلوحة مفاتيح. إذا كانت لغة لوحة المفاتيح في الجهاز عربية
 * فإن الباركود "123ABC" يصل كأحرف عربية. نعيد بناء الحرف من المفتاح الفيزيائي (e.code).
 */
export function latinFromKeyEvent(e: { key: string; code: string; shiftKey: boolean }): string | null {
  const { key, code } = e;
  if (key.length === 1 && /^[\x20-\x7E]$/.test(key)) return key;
  const arabicDigit = '٠١٢٣٤٥٦٧٨٩'.indexOf(key);
  if (arabicDigit >= 0) return String(arabicDigit);
  const persianDigit = '۰۱۲۳۴۵۶۷۸۹'.indexOf(key);
  if (persianDigit >= 0) return String(persianDigit);
  let m = /^Digit(\d)$/.exec(code) ?? /^Numpad(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Key([A-Z])$/.exec(code);
  if (m) return e.shiftKey ? m[1] : m[1].toLowerCase();
  const map: Record<string, string> = {
    Minus: '-',
    NumpadSubtract: '-',
    Period: '.',
    NumpadDecimal: '.',
    Slash: '/',
    NumpadDivide: '/',
    Space: ' ',
    Equal: '=',
    NumpadAdd: '+',
  };
  if (code in map) return e.shiftKey && code === 'Minus' ? '_' : map[code];
  return null;
}

/** يحوّل الأرقام العربية والفارسية في نص ملصوق أو مكتوب إلى أرقام لاتينية */
export function normalizeCode(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .trim();
}
