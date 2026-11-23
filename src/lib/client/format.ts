import type { AppSettings } from '../domain';

export function numberLocale(s: Pick<AppSettings, 'numerals'>) {
  return s.numerals === 'arabic' ? 'ar-EG' : 'en-US';
}

export function makeFormatters(s: AppSettings) {
  const loc = numberLocale(s);
  const num = new Intl.NumberFormat(loc);
  const money = new Intl.NumberFormat(loc, { style: 'currency', currency: s.currency, minimumFractionDigits: 2 });
  const dt = new Intl.DateTimeFormat(s.numerals === 'arabic' ? 'ar-EG' : 'ar-u-nu-latn', {
    timeZone: s.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const d = new Intl.DateTimeFormat(s.numerals === 'arabic' ? 'ar-EG' : 'ar-u-nu-latn', {
    timeZone: s.timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return {
    n: (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : num.format(Number(v))),
    money: (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : money.format(Number(v))),
    dateTime: (v: string | Date | null | undefined) => (v ? dt.format(new Date(v)) : '—'),
    date: (v: string | Date | null | undefined) => (v ? d.format(new Date(v)) : '—'),
    since: (v: string | Date | null | undefined) => {
      if (!v) return '—';
      const mins = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 60000));
      if (mins < 1) return 'الآن';
      if (mins < 60) return `منذ ${num.format(mins)} دقيقة`;
      const h = Math.floor(mins / 60);
      if (h < 48) return `منذ ${num.format(h)} ساعة`;
      return `منذ ${num.format(Math.floor(h / 24))} يوم`;
    },
  };
}

export type Formatters = ReturnType<typeof makeFormatters>;
