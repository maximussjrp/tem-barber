import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_KEYS, ROLE_DEFAULT_PRESETS } from "@/lib/permissions";
import { resolveEffectivePermissions, hasPermission } from "@/lib/permissions/engine";

describe("P0 - Team Permissions Engine", () => {
  it("ALL_PERMISSION_KEYS contains exactly 20 canonical permissions", () => {
    expect(ALL_PERMISSION_KEYS).toHaveLength(20);
  });

  it("OWNER role preset grants all 20 permissions with true", () => {
    const ownerPreset = ROLE_DEFAULT_PRESETS.OWNER;
    for (const key of ALL_PERMISSION_KEYS) {
      expect(ownerPreset[key]).toBe(true);
    }
  });

  it("RECEPTIONIST role preset grants operational permissions but denies financial/team management", () => {
    const receptionistPreset = ROLE_DEFAULT_PRESETS.RECEPTIONIST;

    // Operational permissions: true
    expect(receptionistPreset["AGENDA_VIEW_ALL"]).toBe(true);
    expect(receptionistPreset["AGENDA_CREATE_ALL"]).toBe(true);
    expect(receptionistPreset["AGENDA_EDIT_ALL"]).toBe(true);
    expect(receptionistPreset["AGENDA_BLOCK_ALL"]).toBe(true);
    expect(receptionistPreset["CLIENTS_VIEW"]).toBe(true);
    expect(receptionistPreset["CLIENTS_MANAGE"]).toBe(true);
    expect(receptionistPreset["COMANDAS_ALL"]).toBe(true);
    expect(receptionistPreset["WAITLIST_MANAGE"]).toBe(true);

    // Administrative & financial permissions: false
    expect(receptionistPreset["FINANCIAL_VIEW"]).toBe(false);
    expect(receptionistPreset["CASH_MANAGE"]).toBe(false);
    expect(receptionistPreset["COMMISSIONS_MANAGE"]).toBe(false);
    expect(receptionistPreset["TEAM_MANAGE"]).toBe(false);
    expect(receptionistPreset["SETTINGS_MANAGE"]).toBe(false);
  });

  it("BARBER role preset is restricted to own agenda and checkout", () => {
    const barberPreset = ROLE_DEFAULT_PRESETS.BARBER;

    expect(barberPreset["AGENDA_VIEW_ALL"]).toBe(false);
    expect(barberPreset["AGENDA_CREATE_OWN"]).toBe(true);
    expect(barberPreset["AGENDA_CREATE_ALL"]).toBe(false);
    expect(barberPreset["COMANDAS_OWN"]).toBe(true);
    expect(barberPreset["COMANDAS_ALL"]).toBe(false);
    expect(barberPreset["FINANCIAL_VIEW"]).toBe(false);
    expect(barberPreset["TEAM_MANAGE"]).toBe(false);
    expect(barberPreset["SETTINGS_MANAGE"]).toBe(false);
  });

  it("resolveEffectivePermissions resolves preset defaults when no overrides exist", () => {
    const permissions = resolveEffectivePermissions("RECEPTIONIST", []);

    expect(hasPermission(permissions, "AGENDA_VIEW_ALL")).toBe(true);
    expect(hasPermission(permissions, "FINANCIAL_VIEW")).toBe(false);
    expect(hasPermission(permissions, "TEAM_MANAGE")).toBe(false);
  });

  it("resolveEffectivePermissions applies granular overrides to flip permissions", () => {
    const permissions = resolveEffectivePermissions("RECEPTIONIST", [
      { permissionKey: "FINANCIAL_VIEW", allowed: true },
      { permissionKey: "AGENDA_VIEW_ALL", allowed: false },
    ]);

    // Overridden from false to true
    expect(hasPermission(permissions, "FINANCIAL_VIEW")).toBe(true);
    // Overridden from true to false
    expect(hasPermission(permissions, "AGENDA_VIEW_ALL")).toBe(false);
    // Non-overridden remains preset default
    expect(hasPermission(permissions, "CLIENTS_VIEW")).toBe(true);
  });

  it("hasPermission correctly validates granted keys", () => {
    const permissions = resolveEffectivePermissions("BARBER", []);

    expect(hasPermission(permissions, "AGENDA_CREATE_OWN")).toBe(true);
    expect(hasPermission(permissions, "SETTINGS_MANAGE")).toBe(false);
  });
});
