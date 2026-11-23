import type { DriverStatus, MovementType, OperationKind, Role, ScanSource, StockColor } from '../domain';

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
