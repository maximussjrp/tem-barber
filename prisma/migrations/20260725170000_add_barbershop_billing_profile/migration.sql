-- CreateEnum
CREATE TYPE "BillingPersonType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateTable
CREATE TABLE "barbershop_billing_profiles" (
    "id" TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "person_type" "BillingPersonType" NOT NULL,
    "legal_name" TEXT NOT NULL,
    "cpf_cnpj" TEXT NOT NULL,
    "billing_email" TEXT NOT NULL,
    "billing_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barbershop_billing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "barbershop_billing_profiles_barbershop_id_key" ON "barbershop_billing_profiles"("barbershop_id");

-- AddForeignKey
ALTER TABLE "barbershop_billing_profiles" ADD CONSTRAINT "barbershop_billing_profiles_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
