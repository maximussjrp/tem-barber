export interface AppointmentServiceInput {
  id: string;
  price: { toString(): string } | number | string;
  durationMin: number;
}

export function calculateAppointmentTotals(services: AppointmentServiceInput[]) {
  return {
    totalPrice: services.reduce((sum, service) => sum + Number(service.price), 0),
    durationMin: services.reduce((sum, service) => sum + service.durationMin, 0),
  };
}

export function mapAppointmentServiceSnapshots(services: AppointmentServiceInput[]) {
  return services.map((service) => ({
    serviceId: service.id,
    priceApplied: service.price.toString(),
  }));
}
