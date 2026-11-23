/** شعار رصد: خطوط باركود بالألوان الخمسة داخل إطار ماسح ضوئي */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <rect width="512" height="512" rx="112" fill="#0f172a" />
      <g fill="none" stroke="#f8fafc" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round">
        <path d="M84 156V108a12 12 0 0 1 12-12h48" />
        <path d="M368 96h48a12 12 0 0 1 12 12v48" />
        <path d="M428 356v48a12 12 0 0 1-12 12h-48" />
        <path d="M144 416H96a12 12 0 0 1-12-12v-48" />
      </g>
      <rect x="112" y="152" width="44" height="208" rx="10" fill="#f97316" />
      <rect x="180" y="152" width="24" height="208" rx="8" fill="#3b82f6" />
      <rect x="228" y="152" width="56" height="208" rx="10" fill="#22c55e" />
      <rect x="308" y="152" width="24" height="208" rx="8" fill="#ef4444" />
      <rect x="356" y="152" width="44" height="208" rx="10" fill="#a855f7" />
      <rect x="92" y="248" width="328" height="14" rx="7" fill="#f8fafc" opacity="0.92" />
    </svg>
  );
}

export function Logo({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-xl font-black tracking-tight text-slate-900">رصد</span>
        {subtitle && <span className="mt-1 text-[11px] font-semibold text-slate-500">الدليفري والمستودعات</span>}
      </span>
    </span>
  );
}
