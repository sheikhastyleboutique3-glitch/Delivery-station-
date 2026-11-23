'use client';

import { COLORS, COLOR_META, type StockColor } from '@/lib/domain';
import { cx } from './ui';
import { useApp } from './providers';

export type ColorTotals = Record<StockColor, number>;

/** رمز SVG لكل لون (لا يعتمد على توفر الرموز في الخط) */
export function ColorIcon({ color, className = 'h-3 w-3' }: { color: StockColor; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      {color === 'ORANGE' && <rect x="3.5" y="3.5" width="9" height="9" rx="2" fill="currentColor" />}
      {color === 'BLUE' && <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" {...common} />}
      {color === 'GREEN' && <path d="m3.5 8.5 3 3 6-7" {...common} />}
      {color === 'RED' && (
        <>
          <path d="M8 3.5v5.5" {...common} />
          <circle cx="8" cy="12.3" r="1.3" fill="currentColor" />
        </>
      )}
      {color === 'PURPLE' && <path d="M12.5 8A4.5 4.5 0 1 1 11 4.6M11.5 2v3h-3" {...common} />}
    </svg>
  );
}

/** شارة لونية: لون + رمز + تسمية + عدد. لا يعتمد التمييز على اللون وحده */
export function ColorChip({
  color,
  count,
  onClick,
  active,
  compact,
}: {
  color: StockColor;
  count?: number;
  onClick?: () => void;
  active?: boolean;
  compact?: boolean;
}) {
  const { f } = useApp();
  const m = COLOR_META[color];
  const content = (
    <>
      <span aria-hidden className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', m.solid)}>
        <ColorIcon color={color} />
      </span>
      {!compact && <span className="truncate">{m.label}</span>}
      {count !== undefined && <span className="font-black tabular-nums">{f.n(count)}</span>}
    </>
  );
  const cls = cx(
    'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold',
    m.chip,
    active && `ring-2 ring-offset-1 ${m.ring}`,
    count === 0 && 'opacity-45',
  );
  if (!onClick) return <span className={cls} title={m.description}>{content}</span>;
  return (
    <button type="button" onClick={onClick} className={cx(cls, 'hover:brightness-95')} title={`${m.description} — اضغط لعرض الحركات`} aria-pressed={active}>
      {content}
    </button>
  );
}

/** شريط مكدّس يوضح نسبة كل لون من إجمالي المنتج */
export function ColorBar({ totals }: { totals: ColorTotals }) {
  const sum = COLORS.reduce((s, c) => s + totals[c], 0);
  if (sum === 0) return <div className="h-2.5 rounded-full bg-slate-100" aria-hidden />;
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={COLORS.map((c) => `${COLOR_META[c].label} ${totals[c]}`).join('، ')}>
      {COLORS.map((c) =>
        totals[c] > 0 ? <div key={c} style={{ width: `${(totals[c] / sum) * 100}%`, background: COLOR_META[c].hex }} /> : null,
      )}
    </div>
  );
}

/** بطاقات الإجمالي الخمس أعلى الصفحات */
export function ColorSummary({ totals, active, onSelect }: { totals: ColorTotals; active?: StockColor | null; onSelect?: (c: StockColor | null) => void }) {
  const { f } = useApp();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {COLORS.map((c) => {
        const m = COLOR_META[c];
        const isActive = active === c;
        return (
          <button
            key={c}
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(isActive ? null : c)}
            aria-pressed={isActive}
            className={cx(
              'flex flex-col items-start gap-1 rounded-2xl border bg-white p-3 text-start shadow-sm transition last:col-span-2 sm:last:col-span-1',
              isActive ? `ring-2 ${m.ring} border-transparent` : 'border-slate-200',
              onSelect && 'hover:border-slate-300',
            )}
            style={{ borderInlineStartWidth: 6, borderInlineStartColor: m.hex }}
          >
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
              <span aria-hidden className={cx('flex h-5 w-5 items-center justify-center rounded-full', m.solid)}>
                <ColorIcon color={c} />
              </span>
              {m.label}
            </span>
            <span className="text-2xl font-black tabular-nums text-slate-900">{f.n(totals[c])}</span>
            <span className="hidden text-[11px] leading-tight text-slate-500 sm:block">{m.description}</span>
          </button>
        );
      })}
    </div>
  );
}
