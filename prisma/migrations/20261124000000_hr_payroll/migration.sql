-- CreateEnum
CREATE TYPE "EmployeeJob" AS ENUM ('DRIVER', 'WAREHOUSE_KEEPER', 'HUB_MANAGER', 'ADMINISTRATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('PER_DELIVERY', 'MONTHLY_OR_DAILY', 'HYBRID');

-- CreateEnum
CREATE TYPE "CommissionMode" AS ENUM ('PER_UNIT', 'PER_COLIS');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'OFF');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('AUTO_DISPATCH', 'AUTO_DELIVERY', 'MANUAL');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ID_FRONT', 'ID_BACK', 'PHOTO', 'DRIVING_LICENSE', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CCP', 'BARIDIMOB', 'OTHER');

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "employee_id" TEXT;

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employee_no" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alt_phone" TEXT,
    "address" TEXT,
    "date_of_birth" DATE,
    "nationality" TEXT,
    "notes" TEXT,
    "national_id" TEXT NOT NULL,
    "id_expiry_date" DATE,
    "job_type" "EmployeeJob" NOT NULL,
    "job_title" TEXT,
    "delivery_point_id" TEXT,
    "hire_date" DATE NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "termination_date" DATE,
    "termination_reason" TEXT,
    "driving_license_number" TEXT,
    "driving_license_expiry" DATE,
    "pay_type" "PayType" NOT NULL DEFAULT 'PER_DELIVERY',
    "monthly_salary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "daily_rate" DECIMAL(14,2),
    "work_days_per_month" INTEGER,
    "commission_mode" "CommissionMode" NOT NULL DEFAULT 'PER_UNIT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT,
    "doc_number" TEXT,
    "issue_date" DATE,
    "expiry_date" DATE,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_document_files" (
    "document_id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "employee_document_files_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "attendance_logs" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "source" "AttendanceSource" NOT NULL,
    "received_units" INTEGER NOT NULL DEFAULT 0,
    "delivered_units" INTEGER NOT NULL DEFAULT 0,
    "delivered_colis" INTEGER NOT NULL DEFAULT 0,
    "first_activity_at" TIMESTAMPTZ(3),
    "last_activity_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "set_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_rates" (
    "id" TEXT NOT NULL,
    "mode" "CommissionMode" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "employee_id" TEXT,
    "category" TEXT,
    "delivery_point_id" TEXT,
    "label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_earnings" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mode" "CommissionMode" NOT NULL,
    "category" TEXT,
    "quantity" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "rate_source" TEXT NOT NULL,
    "payout_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_and_delivery_payouts" (
    "id" TEXT NOT NULL,
    "payout_no" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "pay_type" "PayType" NOT NULL,
    "monthly_salary" DECIMAL(14,2) NOT NULL,
    "daily_rate" DECIMAL(14,2) NOT NULL,
    "standard_days" INTEGER NOT NULL,
    "worked_days" INTEGER NOT NULL,
    "base_amount" DECIMAL(14,2) NOT NULL,
    "delivered_units" INTEGER NOT NULL,
    "delivered_colis" INTEGER NOT NULL,
    "commission_amount" DECIMAL(14,2) NOT NULL,
    "bonus_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deduction_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_and_delivery_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_payments" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_no_key" ON "employees"("employee_no");

-- CreateIndex
CREATE UNIQUE INDEX "employees_national_id_key" ON "employees"("national_id");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_job_type_idx" ON "employees"("job_type");

-- CreateIndex
CREATE INDEX "employees_delivery_point_id_idx" ON "employees"("delivery_point_id");

-- CreateIndex
CREATE INDEX "employees_full_name_idx" ON "employees"("full_name");

-- CreateIndex
CREATE INDEX "employee_documents_employee_id_type_idx" ON "employee_documents"("employee_id", "type");

-- CreateIndex
CREATE INDEX "employee_documents_expiry_date_idx" ON "employee_documents"("expiry_date");

-- CreateIndex
CREATE INDEX "attendance_logs_date_idx" ON "attendance_logs"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_logs_employee_id_date_key" ON "attendance_logs"("employee_id", "date");

-- CreateIndex
CREATE INDEX "delivery_rates_mode_is_active_idx" ON "delivery_rates"("mode", "is_active");

-- CreateIndex
CREATE INDEX "delivery_earnings_employee_id_date_idx" ON "delivery_earnings"("employee_id", "date");

-- CreateIndex
CREATE INDEX "delivery_earnings_payout_id_idx" ON "delivery_earnings"("payout_id");

-- CreateIndex
CREATE INDEX "delivery_earnings_operation_id_idx" ON "delivery_earnings"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_and_delivery_payouts_payout_no_key" ON "payroll_and_delivery_payouts"("payout_no");

-- CreateIndex
CREATE INDEX "payroll_and_delivery_payouts_employee_id_period_start_idx" ON "payroll_and_delivery_payouts"("employee_id", "period_start");

-- CreateIndex
CREATE INDEX "payroll_and_delivery_payouts_status_idx" ON "payroll_and_delivery_payouts"("status");

-- CreateIndex
CREATE INDEX "payout_payments_payout_id_idx" ON "payout_payments"("payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_employee_id_key" ON "drivers"("employee_id");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_delivery_point_id_fkey" FOREIGN KEY ("delivery_point_id") REFERENCES "delivery_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document_files" ADD CONSTRAINT "employee_document_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "employee_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_delivery_point_id_fkey" FOREIGN KEY ("delivery_point_id") REFERENCES "delivery_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_earnings" ADD CONSTRAINT "delivery_earnings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_earnings" ADD CONSTRAINT "delivery_earnings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_earnings" ADD CONSTRAINT "delivery_earnings_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_earnings" ADD CONSTRAINT "delivery_earnings_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payroll_and_delivery_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_and_delivery_payouts" ADD CONSTRAINT "payroll_and_delivery_payouts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_and_delivery_payouts" ADD CONSTRAINT "payroll_and_delivery_payouts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_payments" ADD CONSTRAINT "payout_payments_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payroll_and_delivery_payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_payments" ADD CONSTRAINT "payout_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "payout_payments" ADD COLUMN "idempotency_key" TEXT NOT NULL;
CREATE UNIQUE INDEX "payout_payments_idempotency_key_key" ON "payout_payments"("idempotency_key");

-- ═══════════════════ رصد: قيود السلامة لوحدة الموظفين والرواتب ═══════════════════

CREATE SEQUENCE IF NOT EXISTS "employee_no_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "payout_no_seq" START 1000;

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_salary_nonneg" CHECK ("monthly_salary" >= 0),
  ADD CONSTRAINT "employees_daily_rate_nonneg" CHECK ("daily_rate" IS NULL OR "daily_rate" >= 0),
  ADD CONSTRAINT "employees_work_days_range" CHECK ("work_days_per_month" IS NULL OR "work_days_per_month" BETWEEN 1 AND 31),
  ADD CONSTRAINT "employees_terminated_has_date" CHECK ("status" <> 'TERMINATED' OR ("termination_date" IS NOT NULL AND "termination_reason" IS NOT NULL)),
  ADD CONSTRAINT "employees_termination_after_hire" CHECK ("termination_date" IS NULL OR "termination_date" >= "hire_date"),
  ADD CONSTRAINT "employees_birth_before_hire" CHECK ("date_of_birth" IS NULL OR "date_of_birth" < "hire_date");

ALTER TABLE "employee_documents"
  ADD CONSTRAINT "documents_size_range" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880),
  ADD CONSTRAINT "documents_mime_allowed" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

ALTER TABLE "attendance_logs"
  ADD CONSTRAINT "attendance_counts_nonneg" CHECK ("received_units" >= 0 AND "delivered_units" >= 0 AND "delivered_colis" >= 0);

ALTER TABLE "delivery_rates"
  ADD CONSTRAINT "rates_amount_positive" CHECK ("amount" > 0);

-- سعر واحد نشط فقط لكل (نمط، موظف، فئة، نقطة)
CREATE UNIQUE INDEX "delivery_rates_one_active_scope" ON "delivery_rates" (
  "mode", COALESCE("employee_id", ''), COALESCE("category", ''), COALESCE("delivery_point_id", '')
) WHERE "is_active";

ALTER TABLE "delivery_earnings"
  ADD CONSTRAINT "earnings_positive" CHECK ("quantity" > 0 AND "units" > 0 AND "rate" >= 0 AND "amount" >= 0);

ALTER TABLE "payroll_and_delivery_payouts"
  ADD CONSTRAINT "payouts_period_order" CHECK ("period_end" >= "period_start"),
  ADD CONSTRAINT "payouts_amounts_nonneg" CHECK (
    "base_amount" >= 0 AND "commission_amount" >= 0 AND "bonus_amount" >= 0 AND "deduction_amount" >= 0
    AND "net_amount" >= 0 AND "paid_amount" >= 0 AND "worked_days" >= 0 AND "standard_days" > 0
  ),
  ADD CONSTRAINT "payouts_not_overpaid" CHECK ("paid_amount" <= "net_amount");

-- منع كشفين متداخلين لنفس الموظف حتى مع الطلبات المتزامنة
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "payroll_and_delivery_payouts"
  ADD CONSTRAINT "payouts_no_overlap" EXCLUDE USING gist (
    "employee_id" WITH =,
    daterange("period_start", "period_end", '[]') WITH &&
  );

ALTER TABLE "payout_payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);

-- العمولات سجل مالي: لا تُحذف، ولا يتغير فيها إلا ربطها بكشف (payout_id)
CREATE OR REPLACE FUNCTION rasd_earnings_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'لا يمكن حذف عمولة توصيل مسجلة' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.employee_id, NEW.driver_id, NEW.operation_id, NEW.date, NEW.mode, NEW.category, NEW.quantity, NEW.units, NEW.rate, NEW.amount, NEW.rate_source)
     IS DISTINCT FROM
     (OLD.employee_id, OLD.driver_id, OLD.operation_id, OLD.date, OLD.mode, OLD.category, OLD.quantity, OLD.units, OLD.rate, OLD.amount, OLD.rate_source) THEN
    RAISE EXCEPTION 'العمولة مسجلة بسعر وقت التسليم ولا يمكن تعديلها' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "delivery_earnings_guard"
  BEFORE UPDATE OR DELETE ON "delivery_earnings"
  FOR EACH ROW EXECUTE FUNCTION rasd_earnings_guard();

-- ═══════════════════ ترحيل البيانات: ملف وظيفي لكل سائق موجود ═══════════════════

INSERT INTO "employees" (
  "id", "employee_no", "full_name", "phone", "alt_phone", "address", "national_id",
  "job_type", "job_title", "delivery_point_id", "hire_date", "status",
  "pay_type", "monthly_salary", "commission_mode", "created_at", "updated_at"
)
SELECT
  'emp_' || d."id",
  'EMP-' || lpad(nextval('employee_no_seq')::text, 4, '0'),
  d."full_name", d."phone", d."alt_phone", d."address", d."national_id",
  'DRIVER', 'سائق', d."delivery_point_id", d."created_at"::date,
  CASE WHEN d."status" = 'INACTIVE' THEN 'SUSPENDED'::"EmployeeStatus" ELSE 'ACTIVE'::"EmployeeStatus" END,
  'PER_DELIVERY', 0, 'PER_UNIT', now(), now()
FROM "drivers" d
WHERE d."employee_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "employees" e WHERE e."national_id" = d."national_id")
ORDER BY d."created_at";

UPDATE "drivers" d SET "employee_id" = e."id"
FROM "employees" e
WHERE d."employee_id" IS NULL AND e."national_id" = d."national_id";
