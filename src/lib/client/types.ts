import type {
  AttendanceStatus,
  CommissionMode,
  DocumentType,
  DriverStatus,
  EmployeeJob,
  EmployeeStatus,
  MovementType,
  OperationKind,
  PayType,
  PaymentMethod,
  PayoutStatus,
  Role,
  ScanSource,
  StockColor,
} from '../domain';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Point {
  id: string;
  code: string;
  name: string;
  type: 'WAREHOUSE' | 'HUB';
  address: string | null;
  phone: string | null;
  isActive: boolean;
  _count?: { drivers: number; users: number };
}

export interface Driver {
  id: string;
  fullName: string;
  phone: string;
  altPhone: string | null;
  address: string | null;
  nationalId: string;
  vehicleType: string | null;
  vehiclePlate: string | null;
  deliveryPointId: string;
  status: DriverStatus;
  notes: string | null;
  lastSettledAt: string | null;
  deliveryPoint?: { id: string; name: string };
  user?: { id: string; email: string; isActive?: boolean } | null;
  custodyTotal?: number;
  custodySince?: string | null;
  settlements?: {
    id: string;
    createdAt: string;
    summary: Record<string, number | string | null>;
    settledBy: { name: string };
    operation: { opNo: string };
  }[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  altPhone: string | null;
  address: string | null;
  deliveryNotes: string | null;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  unit: string;
  price: string;
  cost: string | null;
  minStockAlert: number;
  trackUnits: boolean;
  imageUrl: string | null;
  isArchived: boolean;
}

export interface Movement {
  id: string;
  movementNo: number;
  type: MovementType;
  quantity: number;
  fromColor: StockColor | null;
  toColor: StockColor | null;
  unitSerials: string[];
  scannedBarcode: string | null;
  scanSource: ScanSource | null;
  reason: string | null;
  notes: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string; barcode: string; unit: string };
  fromPoint: { id: string; name: string } | null;
  toPoint: { id: string; name: string } | null;
  driver?: { id: string; fullName: string } | null;
  customer?: { id: string; name: string; phone: string } | null;
  performedBy?: { id: string; name: string };
  operation?: { id: string; opNo: string; kind: OperationKind; status: string };
}

export interface Operation {
  id: string;
  opNo: string;
  kind: OperationKind;
  status: 'COMPLETED' | 'PENDING_DRIVER_ACK' | 'ACKNOWLEDGED';
  reason: string | null;
  notes: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  totalQuantity?: number;
  deliveryPoint?: { id: string; name: string; code?: string } | null;
  toDeliveryPoint?: { id: string; name: string; code?: string } | null;
  driver?: { id: string; fullName: string; phone?: string; vehiclePlate?: string | null } | null;
  customer?: { id: string; name: string; phone?: string; address?: string | null } | null;
  performedBy?: { id: string; name: string };
  acknowledgedBy?: { id: string; name: string } | null;
  movements?: Movement[];
  settlement?: { summary: Record<string, number | string | null> } | null;
  sourceOperation?: { id: string; opNo: string; kind: OperationKind } | null;
  returns?: { id: string; opNo: string; createdAt: string }[];
  _count?: { movements: number };
}

export interface CustodyLine {
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  unit: string;
  trackUnits: boolean;
  pointId: string;
  pointName: string;
  quantity: number;
  since: string | null;
  serials: string[];
}

export interface Custody {
  driverId: string;
  total: number;
  oldestSince: string | null;
  lines: CustodyLine[];
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  deliveryPointId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  deliveryPoint: { id: string; name: string } | null;
  driver: { id: string; fullName: string } | null;
}

export interface Alert {
  kind: string;
  severity: 'warning' | 'danger' | 'info';
  title: string;
  message: string;
  href: string;
}

// ─── HR ─────────────────────────────────────────────────────────

export interface EmployeeDoc {
  id: string;
  employeeId: string;
  type: DocumentType;
  title: string | null;
  docNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy?: { name: string };
}

export interface Employee {
  id: string;
  employeeNo: string;
  fullName: string;
  phone: string;
  altPhone: string | null;
  address: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  notes: string | null;
  nationalId: string;
  idExpiryDate: string | null;
  jobType: EmployeeJob;
  jobTitle: string | null;
  deliveryPointId: string | null;
  hireDate: string;
  status: EmployeeStatus;
  terminationDate: string | null;
  terminationReason: string | null;
  drivingLicenseNumber: string | null;
  drivingLicenseExpiry: string | null;
  payType: PayType;
  monthlySalary: string;
  dailyRate: string | null;
  workDaysPerMonth: number | null;
  commissionMode: CommissionMode;
  deliveryPoint?: { id: string; name: string } | null;
  driver?: {
    id: string;
    status: DriverStatus;
    vehicleType?: string | null;
    vehiclePlate: string | null;
    user?: { id: string; email: string; isActive: boolean } | null;
    deliveryPoint?: { id: string; name: string };
  } | null;
  documents?: EmployeeDoc[];
  rates?: DeliveryRateRow[];
  driverStats?: Record<string, number> | null;
  custody?: number;
  photoId?: string | null;
  documentsCount?: number;
  nearestExpiry?: string | null;
}

export interface AttendanceLogRow {
  id: string;
  date: string;
  status: AttendanceStatus;
  source: 'AUTO_DISPATCH' | 'AUTO_DELIVERY' | 'MANUAL';
  receivedUnits: number;
  deliveredUnits: number;
  deliveredColis: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  notes: string | null;
  setBy?: { name: string } | null;
}

export interface AttendanceMonth {
  month: string;
  today: string;
  logs: AttendanceLogRow[];
  summary: {
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    offDays: number;
    receivedUnits: number;
    deliveredUnits: number;
    deliveredColis: number;
  };
}

export interface DeliveryRateRow {
  id: string;
  mode: CommissionMode;
  amount: string;
  employeeId: string | null;
  category: string | null;
  deliveryPointId: string | null;
  label: string | null;
  employee?: { id: string; fullName: string; employeeNo: string } | null;
  deliveryPoint?: { id: string; name: string } | null;
}

export interface PayoutCalcView {
  employeeId: string;
  from: string;
  to: string;
  payType: PayType;
  commissionMode: CommissionMode;
  monthlySalary: string;
  dailyRate: string;
  dailyRateIsCustom: boolean;
  standardDays: number;
  workedDays: number;
  baseAmount: string;
  deliveredUnits: number;
  deliveredColis: number;
  commissionAmount: string;
  returnedUnits: number;
  reversalAmount: string;
  grossAmount: string;
  earningsCount: number;
  earningsBreakdown: { kind: 'DELIVERY' | 'RETURN_REVERSAL'; rate: string; mode: CommissionMode; quantity: number; units: number; amount: string; rateSource: string }[];
  overlapping?: { id: string; payoutNo: string } | null;
}

export interface PayoutPaymentRow {
  id: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  paidAt: string;
  createdBy?: { name: string };
}

export interface PayoutRow {
  id: string;
  payoutNo: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  payType: PayType;
  monthlySalary: string;
  dailyRate: string;
  standardDays: number;
  workedDays: number;
  baseAmount: string;
  deliveredUnits: number;
  deliveredColis: number;
  commissionAmount: string;
  returnedUnits: number;
  reversalAmount: string;
  bonusAmount: string;
  deductionAmount: string;
  netAmount: string;
  paidAmount: string;
  remainingAmount: string;
  status: PayoutStatus;
  notes: string | null;
  createdAt: string;
  employee: { id: string; fullName: string; employeeNo: string; jobType: EmployeeJob; payType: PayType; deliveryPoint?: { name: string } | null };
  payments: PayoutPaymentRow[];
  createdBy?: { name: string };
  earnings?: {
    id: string;
    date: string;
    kind: 'DELIVERY' | 'RETURN_REVERSAL';
    mode: CommissionMode;
    category: string | null;
    quantity: number;
    units: number;
    rate: string;
    amount: string;
    rateSource: string;
    operation: { id: string; opNo: string };
    sourceOperation: { id: string; opNo: string } | null;
  }[];
}
