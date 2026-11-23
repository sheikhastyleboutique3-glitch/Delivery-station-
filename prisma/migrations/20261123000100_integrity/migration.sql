-- رصد: قيود السلامة التي لا يعبّر عنها Prisma مباشرة.

-- ─── CHECK constraints ───────────────────────────────────────────

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_nonneg" CHECK ("price" >= 0),
  ADD CONSTRAINT "products_cost_nonneg" CHECK ("cost" >= 0),
  ADD CONSTRAINT "products_min_alert_nonneg" CHECK ("min_stock_alert" >= 0),
  ADD CONSTRAINT "products_sku_not_blank" CHECK (length(btrim("sku")) > 0),
  ADD CONSTRAINT "products_barcode_not_blank" CHECK (length(btrim("barcode")) > 0);

ALTER TABLE "stock_color_balances"
  ADD CONSTRAINT "balances_quantity_nonneg" CHECK ("quantity" >= 0);

ALTER TABLE "driver_custody"
  ADD CONSTRAINT "custody_quantity_nonneg" CHECK ("quantity" >= 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "movements_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "movements_has_side" CHECK ("from_color" IS NOT NULL OR "to_color" IS NOT NULL),
  ADD CONSTRAINT "movements_from_pair" CHECK (("from_color" IS NULL) = ("from_point_id" IS NULL)),
  ADD CONSTRAINT "movements_to_pair" CHECK (("to_color" IS NULL) = ("to_point_id" IS NULL)),
  ADD CONSTRAINT "movements_blue_needs_driver" CHECK (
    ("from_color" IS DISTINCT FROM 'BLUE' AND "to_color" IS DISTINCT FROM 'BLUE') OR "driver_id" IS NOT NULL
  ),
  ADD CONSTRAINT "movements_units_match_qty" CHECK (
    cardinality("unit_serials") = 0 OR cardinality("unit_serials") = "quantity"
  );

ALTER TABLE "users"
  ADD CONSTRAINT "users_hub_manager_has_point" CHECK ("role" <> 'HUB_MANAGER' OR "delivery_point_id" IS NOT NULL),
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "inventory_units"
  ADD CONSTRAINT "units_location_consistent" CHECK (
    ("color" IS NULL AND "delivery_point_id" IS NULL AND "driver_id" IS NULL)
    OR ("color" IS NOT NULL AND "delivery_point_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "units_driver_only_when_blue" CHECK (("color" = 'BLUE') = ("driver_id" IS NOT NULL) OR "color" IS NULL);

-- ─── أرقام السندات المقروءة ────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS "operation_no_seq" START 1000;

-- ─── سجلات للإضافة فقط ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION rasd_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'الجدول % للإضافة فقط: لا يُسمح بالتعديل أو الحذف', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_movements_append_only"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION rasd_forbid_mutation();

CREATE TRIGGER "stock_movements_no_truncate"
  BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION rasd_forbid_mutation();

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION rasd_forbid_mutation();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION rasd_forbid_mutation();
