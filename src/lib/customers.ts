import { Prisma } from "@prisma/client";

export type CustomerLookupResult = {
  id: string;
  name: string;
  phone: string;
};

type CustomerTx = Pick<Prisma.TransactionClient, "appointment" | "user">;

export function normalizePhone(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

export function phonesMatch(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizePhone(left);
  const normalizedRight = normalizePhone(right);
  return !!normalizedLeft && normalizedLeft === normalizedRight;
}

export async function findBarbershopCustomerByPhone(
  tx: CustomerTx,
  barbershopId: string,
  phone: string | null | undefined
): Promise<CustomerLookupResult | null> {
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 8) return null;

  const phoneTail = normalizedPhone.slice(-8);
  const rows = await tx.appointment.findMany({
    where: {
      barbershopId,
      customer: { phone: { contains: phoneTail } },
    },
    distinct: ["customerId"],
    take: 50,
    orderBy: { dateTime: "desc" },
    select: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  return rows.find((row) => phonesMatch(row.customer.phone, normalizedPhone))?.customer ?? null;
}

export async function findBarbershopCustomerById(
  tx: CustomerTx,
  barbershopId: string,
  customerId: string
): Promise<CustomerLookupResult | null> {
  const row = await tx.appointment.findFirst({
    where: { barbershopId, customerId },
    orderBy: { dateTime: "desc" },
    select: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  return row?.customer ?? null;
}

export async function resolveBarbershopCustomerForBooking(
  tx: CustomerTx,
  input: {
    barbershopId: string;
    customerId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
  }
): Promise<CustomerLookupResult> {
  if (input.customerId) {
    const scopedCustomer = await findBarbershopCustomerById(
      tx,
      input.barbershopId,
      input.customerId
    );
    if (!scopedCustomer) {
      throw new Error("CUSTOMER_NOT_FOUND_IN_BARBERSHOP");
    }
    return scopedCustomer;
  }

  const normalizedPhone = normalizePhone(input.customerPhone);
  if (!normalizedPhone) {
    throw new Error("CUSTOMER_PHONE_REQUIRED");
  }

  const existingCustomer = await findBarbershopCustomerByPhone(
    tx,
    input.barbershopId,
    normalizedPhone
  );
  if (existingCustomer) return existingCustomer;

  return tx.user.create({
    data: {
      name: input.customerName?.trim() || "Cliente",
      phone: normalizedPhone,
      role: "USER",
    },
    select: { id: true, name: true, phone: true },
  });
}
