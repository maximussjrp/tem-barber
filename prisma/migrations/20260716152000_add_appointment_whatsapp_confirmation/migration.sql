-- CreateEnum
CREATE TYPE "WhatsappConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "appointment_whatsapp_confirmations" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "status" "WhatsappConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "token_hash" TEXT NOT NULL,
    "token_hint" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_whatsapp_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_whatsapp_confirmations_appointment_id_key" ON "appointment_whatsapp_confirmations"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_whatsapp_confirmations_barbershop_id_status_idx" ON "appointment_whatsapp_confirmations"("barbershop_id", "status");

-- CreateIndex
CREATE INDEX "appointment_whatsapp_confirmations_barbershop_id_expires_at_idx" ON "appointment_whatsapp_confirmations"("barbershop_id", "expires_at");

-- AddForeignKey
ALTER TABLE "appointment_whatsapp_confirmations" ADD CONSTRAINT "appointment_whatsapp_confirmations_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_whatsapp_confirmations" ADD CONSTRAINT "appointment_whatsapp_confirmations_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_whatsapp_confirmations" ADD CONSTRAINT "appointment_whatsapp_confirmations_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
