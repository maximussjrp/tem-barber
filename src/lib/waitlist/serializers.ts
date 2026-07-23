export function sanitizeWaitlistEntryResponse<T extends Record<string, any>>(entry: T) {
  if (!entry) return null;
  const { publicTokenHash, ...sanitized } = entry;
  return sanitized;
}

export interface WaitlistTrackingView {
  entryId: string;
  queueNumber: number;
  currentPosition: number;
  status: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  serviceName?: string;
  preferredMemberId?: string | null;
  preferredMemberName?: string | null;
  skipCount: number;
  noShowCount: number;
  createdAt: Date;
}

export function sanitizeWaitlistPublicTrackingResponse(
  entry: any,
  currentPosition: number
): WaitlistTrackingView {
  return {
    entryId: entry.id,
    queueNumber: entry.queueNumber,
    currentPosition,
    status: entry.status,
    customerName: entry.customerName,
    customerPhone: entry.customerPhone,
    serviceId: entry.serviceId,
    serviceName: entry.service?.name,
    preferredMemberId: entry.preferredMemberId,
    preferredMemberName: entry.preferredMember?.user?.name,
    skipCount: entry.skipCount,
    noShowCount: entry.noShowCount,
    createdAt: entry.createdAt,
  };
}
