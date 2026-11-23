-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'WAREHOUSE', 'HUB_MANAGER', 'DRIVER');

-- CreateEnum
CREATE TYPE "PointType" AS ENUM ('WAREHOUSE', 'HUB');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('AVAILABLE', 'ON_TRIP', 'INACTIVE');

-- CreateEnum
CREATE TYPE "StockColor" AS ENUM ('ORANGE', 'BLUE', 'GREEN', 'RED', 'PURPLE');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('STOCK_IN', 'DISPATCH', 'DELIVERED', 'RETURN_GOOD', 'RETURN_DAMAGED', 'SHORTAGE', 'SORT_TO_AVAILABLE', 'SORT_TO_DAMAGED', 'RESOLVE_RED', 'WRITE_OFF', 'CUSTOMER_RETURN', 'TRANSFER', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "OperationKind" AS ENUM ('STOCK_IN', 'DISPATCH', 'DELIVERY', 'RETURN', 'SORTING', 'RED_RESOLUTION', 'CUSTOMER_RETURN', 'TRANSFER', 'SETTLEMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('COMPLETED', 'PENDING_DRIVER_ACK', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "ScanSource" AS ENUM ('CAMERA', 'EXTERNAL_SCANNER', 'MANUAL');

-- CreateTable
CREATE TABLE "delivery_points" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PointType" NOT NULL DEFAULT 'HUB',
    "address" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "delivery_point_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alt_phone" TEXT,
    "address" TEXT,
    "national_id" TEXT NOT NULL,
    "vehicle_type" TEXT,
    "vehicle_plate" TEXT,
    "delivery_point_id" TEXT NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "last_settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alt_phone" TEXT,
    "address" TEXT,
    "delivery_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'قطعة',
    "price" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "min_stock_alert" INTEGER NOT NULL DEFAULT 0,
    "track_units" BOOLEAN NOT NULL DEFAULT false,
    "image_url" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_color_balances" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "delivery_point_id" TEXT NOT NULL,
    "color" "StockColor" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "nonzero_since" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_color_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_custody" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "delivery_point_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "nonzero_since" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_custody_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_units" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "color" "StockColor",
    "delivery_point_id" TEXT,
    "driver_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL,
    "op_no" TEXT NOT NULL,
    "kind" "OperationKind" NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'COMPLETED',
    "delivery_point_id" TEXT,
    "to_delivery_point_id" TEXT,
    "driver_id" TEXT,
    "customer_id" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "performed_by" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "movement_no" SERIAL NOT NULL,
    "operation_id" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "from_color" "StockColor",
    "from_point_id" TEXT,
    "to_color" "StockColor",
    "to_point_id" TEXT,
    "driver_id" TEXT,
    "customer_id" TEXT,
    "unit_serials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scanned_barcode" TEXT,
    "scan_source" "ScanSource",
    "reason" TEXT,
    "notes" TEXT,
    "performed_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "settled_by" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "period_start" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_points_code_key" ON "delivery_points"("code");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_points_name_key" ON "delivery_points"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_national_id_key" ON "drivers"("national_id");

-- CreateIndex
CREATE INDEX "drivers_delivery_point_id_idx" ON "drivers"("delivery_point_id");

-- CreateIndex
CREATE INDEX "drivers_status_idx" ON "drivers"("status");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "stock_color_balances_color_quantity_idx" ON "stock_color_balances"("color", "quantity");

-- CreateIndex
CREATE INDEX "stock_color_balances_delivery_point_id_color_idx" ON "stock_color_balances"("delivery_point_id", "color");

-- CreateIndex
CREATE UNIQUE INDEX "stock_color_balances_product_id_delivery_point_id_color_key" ON "stock_color_balances"("product_id", "delivery_point_id", "color");

-- CreateIndex
CREATE INDEX "driver_custody_driver_id_quantity_idx" ON "driver_custody"("driver_id", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "driver_custody_driver_id_product_id_delivery_point_id_key" ON "driver_custody"("driver_id", "product_id", "delivery_point_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_serial_key" ON "inventory_units"("serial");

-- CreateIndex
CREATE INDEX "inventory_units_product_id_color_delivery_point_id_idx" ON "inventory_units"("product_id", "color", "delivery_point_id");

-- CreateIndex
CREATE INDEX "inventory_units_driver_id_idx" ON "inventory_units"("driver_id");

-- CreateIndex
CREATE UNIQUE INDEX "operations_op_no_key" ON "operations"("op_no");

-- CreateIndex
CREATE UNIQUE INDEX "operations_idempotency_key_key" ON "operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "operations_kind_created_at_idx" ON "operations"("kind", "created_at");

-- CreateIndex
CREATE INDEX "operations_driver_id_created_at_idx" ON "operations"("driver_id", "created_at");

-- CreateIndex
CREATE INDEX "operations_status_idx" ON "operations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_movement_no_key" ON "stock_movements"("movement_no");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_driver_id_created_at_idx" ON "stock_movements"("driver_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_operation_id_idx" ON "stock_movements"("operation_id");

-- CreateIndex
CREATE INDEX "stock_movements_customer_id_idx" ON "stock_movements"("customer_id");

-- CreateIndex
CREATE INDEX "stock_movements_from_point_id_from_color_idx" ON "stock_movements"("from_point_id", "from_color");

-- CreateIndex
CREATE INDEX "stock_movements_to_point_id_to_color_idx" ON "stock_movements"("to_point_id", "to_color");

-- CreateIndex
CREATE INDEX "stock_movements_scanned_barcode_idx" ON "stock_movements"("scanned_barcode");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_operation_id_key" ON "settlements"("operation_id");

-- CreateIndex
CREATE INDEX "settlements_driver_id_created_at_idx" ON "settlements"("driver_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_hash_key" ON "audit_logs"("hash");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_delivery_point_id_fkey" FOREIGN KEY ("delivery_point_id") REFERENCES "delivery_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_delivery_point_id_fkey" FOREIGN KEY ("delivery_point_id") REFERENCES "delivery_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_color_balances" ADD CONSTRAINT "stock_color_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_color_balances" ADD CONSTRAINT "stock_color_balances_delivery_point_id_fkey" FOREIGN KEY ("delivery_point_id") REFERENCES "delivery_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_custody" ADD CONSTRAINT "driver_custody_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_custody" ADD CONSTRAINT "driver_custody_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_custody" ADD CONSTRAINT "driver_custody_delivery_point_id_fkey" FOREIGN KEY ("delivery_point_id") REFERENCES "delivery_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_delivery_point_id_fkey" FOREIGN KEY ("delivery_point_id") REFERENCES "delivery_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_delivery_point_id_fkey" FOREIGN KEY ("delivery_point_id") REFERENCES "delivery_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_to_delivery_point_id_fkey" FOREIGN KEY ("to_delivery_point_id") REFERENCES "delivery_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_point_id_fkey" FOREIGN KEY ("from_point_id") REFERENCES "delivery_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_point_id_fkey" FOREIGN KEY ("to_point_id") REFERENCES "delivery_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_settled_by_fkey" FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
