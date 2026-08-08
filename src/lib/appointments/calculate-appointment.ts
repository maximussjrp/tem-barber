export interface AppointmentServiceInput {
  id: string;
  price: { toString(): string } | number | string;
  durationMin: number;
  quantity?: number;
}

export function calculateAppointmentTotals(services: AppointmentServiceInput[]) {
  return {
    totalPrice: services.reduce((sum, service) => sum + Number(service.price) * (service.quantity ?? 1), 0),
    durationMin: services.reduce((sum, service) => sum + service.durationMin * (service.quantity ?? 1), 0),
  };
}

export function mapAppointmentServiceSnapshots(services: AppointmentServiceInput[]) {
  return services.map((service) => ({
    serviceId: service.id,
    priceApplied: service.price.toString(),
  }));
}
