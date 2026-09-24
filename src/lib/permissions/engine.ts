import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ALL_PERMISSION_KEYS, PermissionKey, PermissionMap } from "./types";
import { getDefaultPermissionsForRole, ROLE_PRESETS } from "./presets";

type PrismaOrTx = Prisma.TransactionClient | typeof prisma;

/**
 * Returns the effective permissions for a member by resolving:
 * 1. OWNER / SUPER_ADMIN -> all permissions granted unconditionally.
 * 2. Role preset defaults (MANAGER, RECEPTIONIST, BARBER).
 * 3. Member-specific permission overrides from `member_permission_overrides`.
 */
export function resolveEffectivePermissions(
  role: string,
  overrides: Array<{ permissionKey: string; allowed: boolean }> = []
): PermissionMap {
  if (role === "OWNER" || role === "SUPER_ADMIN") {
    return { ...ROLE_PRESETS.OWNER };
  }

  const basePermissions = getDefaultPermissionsForRole(role);

  for (const override of overrides) {
    if (ALL_PERMISSION_KEYS.includes(override.permissionKey as PermissionKey)) {
      basePermissions[override.permissionKey as PermissionKey] = override.allowed;
    }
  }

  return basePermissions;
}

export async function getEffectivePermissions(
  memberId: string,
  role: string,
  db: PrismaOrTx = prisma
): Promise<PermissionMap> {
  if (role === "OWNER" || role === "SUPER_ADMIN") {
    return { ...ROLE_PRESETS.OWNER };
  }

  const overrides = await db.memberPermissionOverride.findMany({
    where: { memberId },
    select: { permissionKey: true, allowed: true },
  });

  return resolveEffectivePermissions(role, overrides);
}

/**
 * Evaluates whether a permission map allows a specific permission key.
 */
export function hasPermission(
  permissions: PermissionMap,
  key: PermissionKey
): boolean {
  return Boolean(permissions[key]);
}

/**
 * Checks if a specific member has a required permission, taking role and overrides into account.
 */
export async function checkMemberPermission(
  memberId: string,
  role: string,
  key: PermissionKey,
  db: PrismaOrTx = prisma
): Promise<boolean> {
  if (role === "OWNER" || role === "SUPER_ADMIN") {
    return true;
  }
  const permissions = await getEffectivePermissions(memberId, role, db);
  return hasPermission(permissions, key);
}

/**
 * Helper for API routes to require a permission, returning an error response if denied.
 */
export async function assertMemberPermission(
  memberId: string,
  role: string,
  key: PermissionKey,
  db: PrismaOrTx = prisma
): Promise<{ allowed: true } | { allowed: false; response: NextResponse }> {
  const allowed = await checkMemberPermission(memberId, role, key, db);
  if (!allowed) {
    return {
      allowed: false,
      response: NextResponse.json(
        {
          error: "PERMISSION_DENIED",
          message: `Permissão '${key}' necessária para executar esta ação.`,
          requiredPermission: key,
        },
        { status: 403 }
      ),
    };
  }
  return { allowed: true };
}
