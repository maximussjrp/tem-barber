DO $$ BEGIN
  CREATE TYPE "ComandaStatus" AS ENUM ('OPEN', 'IN_SERVICE', 'PENDING_PAYMENT', 'CLOSED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CommandPaymentStatus" AS ENUM ('CONFIRMED', 'REFUNDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ComandaItemType" AS ENUM ('SERVICE', 'PRODUCT', 'DISCOUNT', 'SURCHARGE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ComandaItemStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'DEBIT', 'CREDIT', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "StockMovementType" AS ENUM ('SALE', 'REFUND', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FinancialEntryType" AS ENUM ('COMMAND_REVENUE', 'REFUND', 'MANUAL_IN', 'MANUAL_OUT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE "comandas" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "appointment_id" TEXT,
  "customer_id" TEXT,
  "customer_name" TEXT NOT NULL,
  "customer_phone" TEXT,
  "status" "ComandaStatus" NOT NULL DEFAULT 'OPEN',
  "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "discount_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "surcharge_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "paid_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "remaining_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "comandas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "sale_price" DECIMAL(10,2) NOT NULL,
  "cost_price" DECIMAL(10,2),
  "unit" TEXT NOT NULL DEFAULT 'un',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "track_stock" BOOLEAN NOT NULL DEFAULT false,
  "current_stock" DECIMAL(10,3) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comanda_items" (
  "id" TEXT NOT NULL,
  "comanda_id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "type" "ComandaItemType" NOT NULL,
  "status" "ComandaItemStatus" NOT NULL DEFAULT 'PENDING',
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
  "unit_price" DECIMAL(10,2) NOT NULL,
  "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "surcharge_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(10,2) NOT NULL,
  "service_id" TEXT,
  "product_id" TEXT,
  "executor_id" TEXT,
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "comanda_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_movements" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "comanda_item_id" TEXT,
  "type" "StockMovementType" NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "command_payments" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "comanda_id" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "status" "CommandPaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
  "idempotency_key" TEXT,
  "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_by_id" TEXT,
  "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "refund_of_id" TEXT,
  "refund_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "command_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_sessions" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
  "opened_by_id" TEXT NOT NULL,
  "opening_amount" DECIMAL(10,2) NOT NULL,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_by_id" TEXT,
  "closing_amount" DECIMAL(10,2),
  "expected_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "difference" DECIMAL(10,2),
  "closed_at" TIMESTAMP(3),
  CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_movements" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "cash_session_id" TEXT NOT NULL,
  "payment_id" TEXT,
  "amount" DECIMAL(10,2) NOT NULL,
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "financial_entries" (
  "id" TEXT NOT NULL,
  "barbershop_id" TEXT NOT NULL,
  "type" "FinancialEntryType" NOT NULL,
  "category" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "description" TEXT NOT NULL,
  "entry_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "user_id" TEXT,
  "comanda_id" TEXT,
  "payment_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "comandas_appointment_id_key" ON "comandas"("appointment_id");
CREATE INDEX "comandas_barbershop_id_status_idx" ON "comandas"("barbershop_id", "status");
CREATE INDEX "comandas_barbershop_id_opened_at_idx" ON "comandas"("barbershop_id", "opened_at");
CREATE INDEX "products_barbershop_id_is_active_idx" ON "products"("barbershop_id", "is_active");
CREATE INDEX "comanda_items_barbershop_id_comanda_id_idx" ON "comanda_items"("barbershop_id", "comanda_id");
CREATE INDEX "comanda_items_executor_id_status_idx" ON "comanda_items"("executor_id", "status");
CREATE INDEX "stock_movements_barbershop_id_product_id_created_at_idx" ON "stock_movements"("barbershop_id", "product_id", "created_at");
CREATE UNIQUE INDEX "command_payments_barbershop_id_idempotency_key_key" ON "command_payments"("barbershop_id", "idempotency_key");
CREATE INDEX "command_payments_barbershop_id_paid_at_idx" ON "command_payments"("barbershop_id", "paid_at");
CREATE INDEX "command_payments_comanda_id_idx" ON "command_payments"("comanda_id");
CREATE INDEX "cash_sessions_barbershop_id_status_idx" ON "cash_sessions"("barbershop_id", "status");
CREATE UNIQUE INDEX "cash_sessions_one_open_per_tenant_idx" ON "cash_sessions"("barbershop_id") WHERE "status" = 'OPEN';
CREATE INDEX "cash_movements_barbershop_id_cash_session_id_created_at_idx" ON "cash_movements"("barbershop_id", "cash_session_id", "created_at");
CREATE INDEX "financial_entries_barbershop_id_entry_date_idx" ON "financial_entries"("barbershop_id", "entry_date");
CREATE INDEX "financial_entries_barbershop_id_type_idx" ON "financial_entries"("barbershop_id", "type");

ALTER TABLE "comandas" ADD CONSTRAINT "comandas_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_comanda_id_fkey" FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_executor_id_fkey" FOREIGN KEY ("executor_id") REFERENCES "barbershop_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_comanda_item_id_fkey" FOREIGN KEY ("comanda_item_id") REFERENCES "comanda_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "command_payments" ADD CONSTRAINT "command_payments_comanda_id_fkey" FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "command_payments" ADD CONSTRAINT "command_payments_refund_of_id_fkey" FOREIGN KEY ("refund_of_id") REFERENCES "command_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "command_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "command_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
