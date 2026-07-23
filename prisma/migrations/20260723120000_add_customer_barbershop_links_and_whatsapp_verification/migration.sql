-- CreateTable
CREATE TABLE "customer_barbershop_links" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "whatsapp_verified_at" TIMESTAMP(3),
    "whatsapp_verified_by_id" TEXT,
    "whatsapp_verification_method" "AppointmentWhatsappConfirmationMethod",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_barbershop_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_barbershop_links_barbershop_id_customer_id_idx" ON "customer_barbershop_links"("barbershop_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_barbershop_links_barbershop_id_customer_id_key" ON "customer_barbershop_links"("barbershop_id", "customer_id");

-- AddForeignKey
ALTER TABLE "customer_barbershop_links" ADD CONSTRAINT "customer_barbershop_links_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_barbershop_links" ADD CONSTRAINT "customer_barbershop_links_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_barbershop_links" ADD CONSTRAINT "customer_barbershop_links_whatsapp_verified_by_id_fkey" FOREIGN KEY ("whatsapp_verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
