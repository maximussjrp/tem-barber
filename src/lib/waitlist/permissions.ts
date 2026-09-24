export function canManageWaitlist(role: string | undefined): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "RECEPTIONIST";
}

export function canViewWaitlist(role: string | undefined): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "BARBER" || role === "RECEPTIONIST";
}
