export type AppStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type BookingMode = "NORMAL" | "FIT_IN";
export type WhatsappConfirmationStatus = "PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELED";
export type WhatsappConfirmationMethod = "TOKEN" | "MANUAL_OVERRIDE";

export interface AppointmentWhatsappConfirmation {
  status: WhatsappConfirmationStatus;
  tokenHint?: string | null;
  expiresAt?: string | null;
  confirmedAt?: string | null;
  confirmedById?: string | null;
  confirmationMethod?: WhatsappConfirmationMethod | null;
  manualConfirmationReason?: string | null;
}

export interface AppService {
  serviceId?: string;
  service: { id: string; name: string; durationMin: number };
  priceApplied: string;
}

export interface Appointment {
  id: string;
  dateTime: string;
  totalPrice: string;
  durationMin: number;
  status: AppStatus;
  bookingMode?: BookingMode;
  fitInReason?: string | null;
  fitInCreatedAt?: string | null;
  conflictSnapshot?: unknown;
  notes: string | null;
  customer: { id: string; name: string; phone: string };
  barber: { id: string; user: { name: string; avatarUrl: string | null } };
  barbershop?: { name: string };
  services: AppService[];
  comandas?: {
    id: string;
    status: string;
    total: string;
    paidTotal: string;
    items?: { id: string; type: string; status: string; quantity: string }[];
  }[];
  whatsappConfirmation?: AppointmentWhatsappConfirmation | null;
  operationalState?: "ACTIVE" | "AWAITING_PAYMENT" | "COMPLETED";
  productionValue?: number;
}

export interface ScheduleBlock {
  id: string;
  memberId?: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  allDay: boolean;
}

export interface FitInConflictPreview {
  id: string;
  customerName: string;
  start: string;
  end: string;
}

export interface Member {
  id: string;
  user: { name: string; avatarUrl?: string | null };
  startTime?: string;
  endTime?: string;
  freeSlots?: number[];
  serviceIds?: string[];
}

export interface Service {
  id: string;
  name: string;
  price: string;
  durationMin: number;
}

export interface NewAppointmentInitialState {
  memberId?: string;
  dateTime?: string;
  serviceIds?: string[];
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface CustomerSearchResult {
  id: string;
  name: string;
  phone: string;
  lastAppointmentAt?: string;
}

export interface ClubBenefit {
  serviceId: string;
  benefitType: "INCLUDED_SERVICE" | "SERVICE_DISCOUNT";
  isUnlimited?: boolean;
  availableQty?: number;
  includedQty?: number;
  canUse?: boolean;
  discountPercent?: number;
}

export interface ClubBalance {
  status?: string;
  clubPlan?: { id?: string; name: string };
  benefits?: ClubBenefit[];
}

export type UIStatus =
  | "PENDING"
  | "CONFIRMED"
  | "OPEN_COMANDA"
  | "IN_SERVICE"
  | "PENDING_PAYMENT"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export interface AppointmentLayout {
  appointment: Appointment;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
}

export interface DayItem {
  iso: string;
  weekday: string;
  dayNum: string;
  label: string;
}
