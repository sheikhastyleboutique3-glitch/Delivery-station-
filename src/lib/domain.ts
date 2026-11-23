/**
 * ثوابت المجال — المصدر الوحيد للحقيقة للألوان والانتقالات والأدوار.
 * هذا الملف لا يستورد Prisma حتى يمكن استخدامه في الواجهة والخادم معاً.
 * القيم مطابقة حرفياً لـ enums في prisma/schema.prisma.
 */

export const COLORS = ['ORANGE', 'BLUE', 'GREEN', 'RED', 'PURPLE'] as const;
export type StockColor = (typeof COLORS)[number];

export const ROLES = ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER', 'DRIVER'] as const;
export type Role = (typeof ROLES)[number];

export const MOVEMENT_TYPES = [
  'STOCK_IN',
  'DISPATCH',
  'DELIVERED',
  'RETURN_GOOD',
  'RETURN_DAMAGED',
  'SHORTAGE',
  'SORT_TO_AVAILABLE',
  'SORT_TO_DAMAGED',
  'RESOLVE_RED',
  'WRITE_OFF',
  'CUSTOMER_RETURN',
  'TRANSFER',
  'STATUS_CHANGE',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const OPERATION_KINDS = [
  'STOCK_IN',
  'DISPATCH',
  'DELIVERY',
  'RETURN',
  'SORTING',
  'RED_RESOLUTION',
  'CUSTOMER_RETURN',
  'TRANSFER',
  'SETTLEMENT',
  'ADJUSTMENT',
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const SCAN_SOURCES = ['CAMERA', 'EXTERNAL_SCANNER', 'MANUAL'] as const;
export type ScanSource = (typeof SCAN_SOURCES)[number];

export const DRIVER_STATUSES = ['AVAILABLE', 'ON_TRIP', 'INACTIVE'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

// ─── Colors ─────────────────────────────────────────────────────

export interface ColorMeta {
  key: StockColor;
  label: string;
  description: string;
  icon: string; // رمز نصي يرافق اللون حتى لا يعتمد التمييز على اللون وحده
  hex: string;
  chip: string; // Tailwind classes للشارة
  solid: string; // Tailwind classes للخلفية الممتلئة
  ring: string;
}

export const COLOR_META: Record<StockColor, ColorMeta> = {
  ORANGE: {
    key: 'ORANGE',
    label: 'متاح',
    description: 'موجود في المستودع وجاهز للصرف',
    icon: '●',
    hex: '#ea580c',
    chip: 'bg-orange-100 text-orange-900 border-orange-300',
    solid: 'bg-orange-500 text-white',
    ring: 'ring-orange-400',
  },
  BLUE: {
    key: 'BLUE',
    label: 'خارج المستودع',
    description: 'عهدة مع سائق',
    icon: '➜',
    hex: '#2563eb',
    chip: 'bg-blue-100 text-blue-900 border-blue-300',
    solid: 'bg-blue-600 text-white',
    ring: 'ring-blue-400',
  },
  GREEN: {
    key: 'GREEN',
    label: 'مُسلّم',
    description: 'تم تسليمه للعميل بنجاح',
    icon: '✓',
    hex: '#16a34a',
    chip: 'bg-green-100 text-green-900 border-green-300',
    solid: 'bg-green-600 text-white',
    ring: 'ring-green-400',
  },
  RED: {
    key: 'RED',
    label: 'تالف / ناقص',
    description: 'مرتجع تالف أو ناقص أو مفقود ويحتاج إجراءً',
    icon: '!',
    hex: '#dc2626',
    chip: 'bg-red-100 text-red-900 border-red-300',
    solid: 'bg-red-600 text-white',
    ring: 'ring-red-400',
  },
  PURPLE: {
    key: 'PURPLE',
    label: 'بانتظار الفرز',
    description: 'مرتجع سليم بانتظار الفرز وإعادة الإتاحة',
    icon: '↺',
    hex: '#9333ea',
    chip: 'bg-purple-100 text-purple-900 border-purple-300',
    solid: 'bg-purple-600 text-white',
    ring: 'ring-purple-400',
  },
};

// ─── Transition matrix ──────────────────────────────────────────

export interface Transition {
  type: MovementType;
  from: StockColor | null;
  to: StockColor | null;
  roles: readonly Role[];
  reasonRequired: boolean;
  label: string;
}

const STAFF: readonly Role[] = ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'];

/**
 * الانتقالات المسموحة فقط. أي (نوع، من، إلى) غير موجود هنا يُرفض.
 * STATUS_CHANGE لا يُدرج هنا لأنه يسمح بأي لونين غير الأزرق (انظر isAllowedTransition).
 */
export const TRANSITIONS: readonly Transition[] = [
  { type: 'STOCK_IN', from: null, to: 'ORANGE', roles: STAFF, reasonRequired: false, label: 'إدخال مخزون' },
  { type: 'DISPATCH', from: 'ORANGE', to: 'BLUE', roles: STAFF, reasonRequired: false, label: 'صرف لسائق' },
  { type: 'DELIVERED', from: 'BLUE', to: 'GREEN', roles: [...STAFF, 'DRIVER'], reasonRequired: false, label: 'تسليم للعميل' },
  { type: 'RETURN_GOOD', from: 'BLUE', to: 'PURPLE', roles: STAFF, reasonRequired: false, label: 'إرجاع سليم (للفرز)' },
  { type: 'RETURN_GOOD', from: 'BLUE', to: 'ORANGE', roles: STAFF, reasonRequired: false, label: 'إرجاع سليم (متاح مباشرة)' },
  { type: 'RETURN_DAMAGED', from: 'BLUE', to: 'RED', roles: STAFF, reasonRequired: true, label: 'إرجاع تالف / ناقص' },
  { type: 'SHORTAGE', from: 'BLUE', to: 'RED', roles: ['ADMIN', 'WAREHOUSE'], reasonRequired: true, label: 'عجز عند التسوية' },
  { type: 'SORT_TO_AVAILABLE', from: 'PURPLE', to: 'ORANGE', roles: STAFF, reasonRequired: false, label: 'فرز: إعادة إتاحة' },
  { type: 'SORT_TO_DAMAGED', from: 'PURPLE', to: 'RED', roles: STAFF, reasonRequired: true, label: 'فرز: تالف' },
  { type: 'RESOLVE_RED', from: 'RED', to: 'ORANGE', roles: ['ADMIN'], reasonRequired: true, label: 'معالجة: إعادة إتاحة' },
  { type: 'WRITE_OFF', from: 'RED', to: null, roles: ['ADMIN'], reasonRequired: true, label: 'شطب' },
  { type: 'CUSTOMER_RETURN', from: 'GREEN', to: 'PURPLE', roles: STAFF, reasonRequired: true, label: 'مرتجع عميل سليم' },
  { type: 'CUSTOMER_RETURN', from: 'GREEN', to: 'RED', roles: STAFF, reasonRequired: true, label: 'مرتجع عميل تالف' },
  { type: 'TRANSFER', from: 'ORANGE', to: 'ORANGE', roles: STAFF, reasonRequired: false, label: 'تحويل بين النقاط' },
];

export const STATUS_CHANGE_ROLES: readonly Role[] = ['ADMIN'];

export function findTransition(type: MovementType, from: StockColor | null, to: StockColor | null): Transition | null {
  if (type === 'STATUS_CHANGE') {
    // تعديل استثنائي: Admin فقط، بين لونين مختلفين، ولا يمس الأزرق (لأنه مرتبط بعهدة سائق).
    if (!from || !to || from === to || from === 'BLUE' || to === 'BLUE') return null;
    return { type, from, to, roles: STATUS_CHANGE_ROLES, reasonRequired: true, label: 'تعديل استثنائي للحالة' };
  }
  return TRANSITIONS.find((t) => t.type === type && t.from === from && t.to === to) ?? null;
}

export function isAllowedTransition(type: MovementType, from: StockColor | null, to: StockColor | null, role: Role): boolean {
  const t = findTransition(type, from, to);
  return !!t && t.roles.includes(role);
}

// ─── Labels ─────────────────────────────────────────────────────

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'مدير النظام',
  WAREHOUSE: 'أمين المستودع',
  HUB_MANAGER: 'مسؤول نقطة دليفري',
  DRIVER: 'سائق',
};

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  STOCK_IN: 'إدخال مخزون',
  DISPATCH: 'صرف لسائق',
  DELIVERED: 'تسليم للعميل',
  RETURN_GOOD: 'إرجاع سليم',
  RETURN_DAMAGED: 'إرجاع تالف / ناقص',
  SHORTAGE: 'عجز عند التسوية',
  SORT_TO_AVAILABLE: 'فرز: إعادة إتاحة',
  SORT_TO_DAMAGED: 'فرز: تالف',
  RESOLVE_RED: 'معالجة الأحمر',
  WRITE_OFF: 'شطب',
  CUSTOMER_RETURN: 'مرتجع من عميل',
  TRANSFER: 'تحويل بين النقاط',
  STATUS_CHANGE: 'تعديل استثنائي',
};

export const OPERATION_LABELS: Record<OperationKind, string> = {
  STOCK_IN: 'سند إدخال',
  DISPATCH: 'سند صرف',
  DELIVERY: 'سند تسليم',
  RETURN: 'سند إرجاع',
  SORTING: 'سند فرز',
  RED_RESOLUTION: 'سند معالجة',
  CUSTOMER_RETURN: 'مرتجع عميل',
  TRANSFER: 'سند تحويل',
  SETTLEMENT: 'تسوية عهدة',
  ADJUSTMENT: 'تعديل استثنائي',
};

export const OPERATION_PREFIX: Record<OperationKind, string> = {
  STOCK_IN: 'IN',
  DISPATCH: 'DSP',
  DELIVERY: 'DLV',
  RETURN: 'RET',
  SORTING: 'SRT',
  RED_RESOLUTION: 'RES',
  CUSTOMER_RETURN: 'CRT',
  TRANSFER: 'TRF',
  SETTLEMENT: 'SET',
  ADJUSTMENT: 'ADJ',
};

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  AVAILABLE: 'متاح',
  ON_TRIP: 'في رحلة',
  INACTIVE: 'غير نشط',
};

export const SCAN_SOURCE_LABELS: Record<ScanSource, string> = {
  CAMERA: 'كاميرا',
  EXTERNAL_SCANNER: 'سكانر خارجي',
  MANUAL: 'يدوي',
};

// ─── Settings ───────────────────────────────────────────────────

export interface AppSettings {
  companyName: string;
  /** سعر التوصيل الافتراضي لكل قطعة مسلّمة */
  defaultRatePerUnit: number;
  /** سعر التوصيل الافتراضي لكل طرد / طلب مكتمل */
  defaultRatePerColis: number;
  /** أيام العمل المعيارية في الشهر (لحساب أجر اليوم من الراتب الشهري) */
  standardWorkDays: number;
  /** التنبيه قبل انتهاء صلاحية الوثائق بعدد أيام */
  documentExpiryAlertDays: number;
  autoRestockGoodReturns: boolean;
  redAlertHours: number;
  custodyAlertHours: number;
  pendingAckAlertHours: number;
  currency: string;
  timezone: string;
  numerals: 'latin' | 'arabic';
  barcodeFormat: 'CODE128' | 'EAN13' | 'QR';
  labelWidthMm: number;
  labelHeightMm: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: 'رصد',
  defaultRatePerUnit: 200,
  defaultRatePerColis: 200,
  standardWorkDays: 26,
  documentExpiryAlertDays: 30,
  autoRestockGoodReturns: false,
  redAlertHours: 24,
  custodyAlertHours: 24,
  pendingAckAlertHours: 2,
  currency: 'DZD',
  timezone: 'Africa/Algiers',
  numerals: 'latin',
  barcodeFormat: 'CODE128',
  labelWidthMm: 50,
  labelHeightMm: 30,
};

// ─── Barcode helpers ────────────────────────────────────────────

/** خانة التحقق لـ EAN-13 من أول 12 رقماً */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

// ─── HR: الموظفون والحضور والرواتب ─────────────────────────────

export const EMPLOYEE_JOBS = ['DRIVER', 'WAREHOUSE_KEEPER', 'HUB_MANAGER', 'ADMINISTRATIVE', 'OTHER'] as const;
export type EmployeeJob = (typeof EMPLOYEE_JOBS)[number];
export const EMPLOYEE_JOB_LABELS: Record<EmployeeJob, string> = {
  DRIVER: 'سائق',
  WAREHOUSE_KEEPER: 'أمين مستودع',
  HUB_MANAGER: 'مسؤول نقطة دليفري',
  ADMINISTRATIVE: 'إداري',
  OTHER: 'أخرى',
};

export const EMPLOYEE_STATUSES = ['ACTIVE', 'SUSPENDED', 'TERMINATED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'نشط',
  SUSPENDED: 'موقوف',
  TERMINATED: 'متوقف عن العمل',
};

export const PAY_TYPES = ['PER_DELIVERY', 'MONTHLY_OR_DAILY', 'HYBRID'] as const;
export type PayType = (typeof PAY_TYPES)[number];
export const PAY_TYPE_LABELS: Record<PayType, string> = {
  PER_DELIVERY: 'عمولة بالتوصيل',
  MONTHLY_OR_DAILY: 'راتب شهري / أيام عمل',
  HYBRID: 'هجين (أجر أيام + عمولة)',
};
export const payTypeHasBase = (t: PayType) => t !== 'PER_DELIVERY';
export const payTypeHasCommission = (t: PayType) => t !== 'MONTHLY_OR_DAILY';

export const COMMISSION_MODES = ['PER_UNIT', 'PER_COLIS'] as const;
export type CommissionMode = (typeof COMMISSION_MODES)[number];
export const COMMISSION_MODE_LABELS: Record<CommissionMode, string> = {
  PER_UNIT: 'لكل قطعة مسلّمة',
  PER_COLIS: 'لكل طرد / طلب مكتمل',
};

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LEAVE', 'OFF'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'حاضر',
  ABSENT: 'غائب',
  LEAVE: 'إجازة',
  OFF: 'راحة',
};
export const ATTENDANCE_SOURCE_LABELS: Record<'AUTO_DISPATCH' | 'AUTO_DELIVERY' | 'MANUAL', string> = {
  AUTO_DISPATCH: 'تلقائي: استلام للتوصيل',
  AUTO_DELIVERY: 'تلقائي: تسليم',
  MANUAL: 'يدوي',
};

export const DOCUMENT_TYPES = ['ID_FRONT', 'ID_BACK', 'PHOTO', 'DRIVING_LICENSE', 'CONTRACT', 'OTHER'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ID_FRONT: 'بطاقة التعريف (الوجه)',
  ID_BACK: 'بطاقة التعريف (الخلف)',
  PHOTO: 'الصورة الشخصية',
  DRIVING_LICENSE: 'رخصة القيادة',
  CONTRACT: 'عقد العمل',
  OTHER: 'وثيقة أخرى',
};
export const ALLOWED_DOCUMENT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const PAYOUT_STATUSES = ['PENDING', 'PARTIAL', 'PAID'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  PENDING: 'معلق',
  PARTIAL: 'جزئي',
  PAID: 'مدفوع',
};

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CCP', 'BARIDIMOB', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'نقداً',
  BANK_TRANSFER: 'تحويل بنكي',
  CCP: 'حساب بريدي جاري (CCP)',
  BARIDIMOB: 'بريدي موب',
  OTHER: 'أخرى',
};
