-- CreateEnum
CREATE TYPE "AppointmentWhatsappConfirmationMethod" AS ENUM ('TOKEN', 'MANUAL_OVERRIDE');

-- AlterTable
ALTER TABLE "appointment_whatsapp_confirmations"
ADD COLUMN "confirmation_method" "AppointmentWhatsappConfirmationMethod",
ADD COLUMN "manual_confirmation_reason" TEXT;
