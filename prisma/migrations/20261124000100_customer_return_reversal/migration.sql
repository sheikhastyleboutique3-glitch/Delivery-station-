-- CreateEnum
CREATE TYPE "EarningKind" AS ENUM ('DELIVERY', 'RETURN_REVERSAL');

-- AlterTable
ALTER TABLE "delivery_earnings" ADD COLUMN     "kind" "EarningKind" NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN     "source_operation_id" TEXT;

-- AlterTable
ALTER TABLE "operations" ADD COLUMN     "source_operation_id" TEXT;

-- AlterTable
ALTER TABLE "payroll_and_delivery_payouts" ADD COLUMN     "returned_units" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reversal_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "delivery_earnings_source_operation_id_idx" ON "delivery_earnings"("source_operation_id");

-- CreateIndex
CREATE INDEX "operations_source_operation_id_idx" ON "operations"("source_operation_id");

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_source_operation_id_fkey" FOREIGN KEY ("source_operation_id") REFERENCES "operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_earnings" ADD CONSTRAINT "delivery_earnings_source_operation_id_fkey" FOREIGN KEY ("source_operation_id") REFERENCES "operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════ رصد: إلغاء عمولة التوصيل عند مرتجع العميل ═══════════

ALTER TABLE "payroll_and_delivery_payouts"
  ADD CONSTRAINT "payouts_reversal_nonneg" CHECK ("reversal_amount" >= 0 AND "returned_units" >= 0);

-- سطر الإلغاء يجب أن يشير إلى سند التسليم الأصلي
ALTER TABLE "delivery_earnings"
  ADD CONSTRAINT "earnings_reversal_has_source" CHECK ("kind" = 'DELIVERY' OR "source_operation_id" IS NOT NULL);

-- العمولة وسطر إلغائها لا يُعدَّلان (إلا ربطهما بكشف) ولا يُحذفان
CREATE OR REPLACE FUNCTION rasd_earnings_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'لا يمكن حذف عمولة توصيل مسجلة' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.employee_id, NEW.driver_id, NEW.operation_id, NEW.kind, NEW.source_operation_id, NEW.date, NEW.mode, NEW.category,
      NEW.quantity, NEW.units, NEW.rate, NEW.amount, NEW.rate_source)
     IS DISTINCT FROM
     (OLD.employee_id, OLD.driver_id, OLD.operation_id, OLD.kind, OLD.source_operation_id, OLD.date, OLD.mode, OLD.category,
      OLD.quantity, OLD.units, OLD.rate, OLD.amount, OLD.rate_source) THEN
    RAISE EXCEPTION 'العمولة مسجلة بسعر وقت التسليم ولا يمكن تعديلها' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
