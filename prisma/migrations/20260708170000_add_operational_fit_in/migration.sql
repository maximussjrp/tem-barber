-- Add explicit booking mode and operational fit-in metadata to appointments.
CREATE TYPE "AppointmentBookingMode" AS ENUM ('NORMAL', 'FIT_IN');

ALTER TABLE "appointments"
ADD COLUMN "booking_mode" "AppointmentBookingMode" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN "fit_in_reason" TEXT,
ADD COLUMN "fit_in_created_by_id" TEXT,
ADD COLUMN "fit_in_created_at" TIMESTAMP(3),
ADD COLUMN "conflict_snapshot" JSONB;
