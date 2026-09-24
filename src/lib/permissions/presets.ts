import { ALL_PERMISSION_KEYS, PermissionMap } from "./types";

export const ROLE_PRESETS: Record<string, PermissionMap> = {
  OWNER: ALL_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as PermissionMap),

  MANAGER: {
    AGENDA_VIEW_ALL: true,
    AGENDA_CREATE_OWN: true,
    AGENDA_CREATE_ALL: true,
    AGENDA_EDIT_OWN: true,
    AGENDA_EDIT_ALL: true,
    AGENDA_BLOCK_OWN: true,
    AGENDA_BLOCK_ALL: true,
    CLIENTS_VIEW: true,
    CLIENTS_MANAGE: true,
    COMANDAS_OWN: true,
    COMANDAS_ALL: true,
    DISCOUNT_APPLY: true,
    CASH_MANAGE: true,
    FINANCIAL_VIEW: true,
    COMMISSIONS_MANAGE: false,
    TIPS_MANAGE: true,
    WAITLIST_MANAGE: true,
    TEAM_MANAGE: false,
    SERVICES_MANAGE: true,
    SETTINGS_MANAGE: false,
  },

  RECEPTIONIST: {
    AGENDA_VIEW_ALL: true,
    AGENDA_CREATE_OWN: false,
    AGENDA_CREATE_ALL: true,
    AGENDA_EDIT_OWN: false,
    AGENDA_EDIT_ALL: true,
    AGENDA_BLOCK_OWN: false,
    AGENDA_BLOCK_ALL: true,
    CLIENTS_VIEW: true,
    CLIENTS_MANAGE: true,
    COMANDAS_OWN: false,
    COMANDAS_ALL: true,
    DISCOUNT_APPLY: false,
    CASH_MANAGE: false,
    FINANCIAL_VIEW: false,
    COMMISSIONS_MANAGE: false,
    TIPS_MANAGE: false,
    WAITLIST_MANAGE: true,
    TEAM_MANAGE: false,
    SERVICES_MANAGE: false,
    SETTINGS_MANAGE: false,
  },

  BARBER: {
    AGENDA_VIEW_ALL: false,
    AGENDA_CREATE_OWN: true,
    AGENDA_CREATE_ALL: false,
    AGENDA_EDIT_OWN: true,
    AGENDA_EDIT_ALL: false,
    AGENDA_BLOCK_OWN: true,
    AGENDA_BLOCK_ALL: false,
    CLIENTS_VIEW: false,
    CLIENTS_MANAGE: false,
    COMANDAS_OWN: true,
    COMANDAS_ALL: false,
    DISCOUNT_APPLY: false,
    CASH_MANAGE: false,
    FINANCIAL_VIEW: false,
    COMMISSIONS_MANAGE: false,
    TIPS_MANAGE: false,
    WAITLIST_MANAGE: false,
    TEAM_MANAGE: false,
    SERVICES_MANAGE: false,
    SETTINGS_MANAGE: false,
  },
};

export function getDefaultPermissionsForRole(role: string): PermissionMap {
  const preset = ROLE_PRESETS[role];
  if (preset) {
    return { ...preset };
  }
  return ALL_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as PermissionMap);
}

export const ROLE_DEFAULT_PRESETS = ROLE_PRESETS;
