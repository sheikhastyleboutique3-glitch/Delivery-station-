/** أيقونات SVG مضمّنة: لا تعتمد على توفر رموز معينة في خطوط الجهاز */

const PATHS = {
  home: 'M3 11 12 3l9 8M5 10v10h14V10',
  warehouse: 'M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10',
  dispatch: 'M2 6h12v11H2zM14 10h4l3 3v4h-7M6 20.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 20.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  returns: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  plus: 'M12 5v14M5 12h14',
  sorting: 'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4',
  transfer: 'M4 8h15l-3-3M20 16H5l3 3',
  driver: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7M18 14a6 6 0 0 1 4 7',
  chart: 'M5 20V11M11 20V4M17 20v-6M22 20H2',
  pin: 'M12 21s-7-6-7-12a7 7 0 0 1 14 0c0 6-7 12-7 12ZM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  key: 'M15 7a4 4 0 1 1-4.9 3.9L3 18v3h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7ZM16 8h.01',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3ZM9 12l2 2 4-4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  clipboard: 'M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M9 12h6M9 16h4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  camera: 'M3 8h3.5l2-3h7l2 3H21v11H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  check: 'm4 12.5 5 5L20 6.5',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  idcard: 'M3 5h18v14H3zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 16a3 3 0 0 1 6 0M14 9h4M14 13h4',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 2-3h11v3M17 13.5h.01',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  file: 'M6 3h9l4 4v14H6zM15 3v4h4',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  calculator: 'M5 3h14v18H5zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
