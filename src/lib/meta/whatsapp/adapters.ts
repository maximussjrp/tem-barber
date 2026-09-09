/**
 * Meta WhatsApp Provider Adapters
 * Phase R6.1B - Coexistence Provider Adapters with Fail-Closed Token Authority & Reconciliation
 */

import { getMetaConfig, MetaWabaSystemUserTask } from "../config";
import { metaGraphFetch } from "../client";
import { MetaApiError } from "../errors";

export interface TransientTokenResult {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
}

export interface DebugTokenResult {
  isValid: boolean;
  appId: string;
  scopes: string[];
  granularScopes?: Array<{ scope: string; target_ids?: string[] }>;
}

export interface DiscoveredWaba {
  id: string;
  name?: string;
  currency?: string;
  timezoneId?: string;
  messageTemplateNamespace?: string;
}

export interface DiscoveredPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName?: string;
  qualityRating?: string;
  status?: string;
  codeVerificationStatus?: string;
}

export interface AssignedUser {
  id: string;
  name?: string;
  tasks: string[];
}

export interface WabaSubscriptionEntry {
  whatsapp_business_api_data?: {
    id?: string;
    link?: string;
    name?: string;
  };
}

export interface MetaPaginatedResponse<T> {
  data: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
}

/**
 * Traverses Meta Graph API pagination until end of pages or predicate is met.
 * Strictly validates that pagination URLs point to graph.facebook.com.
 */
export async function fetchAllPages<T>(
  endpoint: string,
  accessToken: string,
  params: Record<string, string | number | boolean | undefined>,
  predicate?: (item: T) => boolean
): Promise<T[]> {
  let allItems: T[] = [];
  let currentEndpoint = endpoint;
  let currentParams: Record<string, string | number | boolean | undefined> = { ...params };

  while (true) {
    const res = await metaGraphFetch<MetaPaginatedResponse<T>>({
      endpoint: currentEndpoint,
      accessToken,
      params: currentParams,
    });

    const items = res?.data || [];
    allItems = allItems.concat(items);

    if (predicate && items.some(predicate)) {
      break;
    }

    const nextUrl = res?.paging?.next;
    if (!nextUrl) {
      break;
    }

    // Strict Host Validation
    const parsed = new URL(nextUrl);
    if (parsed.hostname !== "graph.facebook.com") {
      throw new MetaApiError(
        `Invalid pagination host in next URL: ${parsed.hostname}`,
        { isTransient: false }
      );
    }

    // Extract relative endpoint path without version prefix
    const pathParts = parsed.pathname.replace(/^\/+/, "").split("/");
    const endpointPath = pathParts[0]?.startsWith("v")
      ? pathParts.slice(1).join("/")
      : pathParts.join("/");

    currentEndpoint = `/${endpointPath}`;
    currentParams = {};
    const safePaginationKeys = ["after", "before", "limit"];
    for (const key of safePaginationKeys) {
      const val = parsed.searchParams.get(key);
      if (val !== null) {
        currentParams[key] = val;
      }
    }
    // Maintain fields if present in initial params
    if (params.fields && !currentParams.fields) {
      currentParams.fields = params.fields;
    }
  }

  return allItems;
}

/**
 * Exchanges transient OAuth authorization code from Embedded Signup for a transient access token.
 */
export async function exchangeEmbeddedSignupCode(
  code: string
): Promise<TransientTokenResult> {
  const config = getMetaConfig();

  if (!config.appId || !config.appSecret) {
    throw new MetaApiError("Meta App ID or App Secret not configured.", {
      isTransient: false,
    });
  }

  const res = await metaGraphFetch<{
    access_token: string;
    token_type?: string;
    expires_in?: number;
  }>({
    endpoint: "/oauth/access_token",
    params: {
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
    },
    includeAppSecretProof: false,
  });

  if (!res || !res.access_token) {
    throw new MetaApiError("Failed to exchange OAuth code for access token.", {
      isTransient: false,
    });
  }

  return {
    accessToken: res.access_token,
    tokenType: res.token_type,
    expiresIn: res.expires_in,
  };
}

/**
 * Validates transient OAuth token via debug_token endpoint using App Token authority.
 * Enforces is_valid, app_id match, required scopes, and granular scope target validation.
 */
export async function debugOAuthToken(
  transientToken: string,
  expectedWabaId?: string
): Promise<DebugTokenResult> {
  const config = getMetaConfig();
  const appToken = `${config.appId}|${config.appSecret}`;

  const res = await metaGraphFetch<{
    data: {
      app_id?: string;
      is_valid?: boolean;
      scopes?: string[];
      granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
      error?: { message?: string; code?: number };
    };
  }>({
    endpoint: "/debug_token",
    accessToken: appToken,
    params: {
      input_token: transientToken,
    },
    includeAppSecretProof: false,
  });

  const data = res?.data;
  if (!data || !data.is_valid) {
    throw new MetaApiError(
      `Invalid OAuth token: ${data?.error?.message || "Token is not valid"}.`,
      { httpStatus: 403, code: "INVALID_OAUTH_TOKEN", isTransient: false }
    );
  }

  if (String(data.app_id) !== String(config.appId)) {
    throw new MetaApiError(
      `Token app_id mismatch. Expected ${config.appId}, received ${data.app_id}.`,
      { httpStatus: 403, code: "OAUTH_PERMISSION_DENIED", isTransient: false }
    );
  }

  const scopes = data.scopes || [];
  const granularScopes = data.granular_scopes || [];
  const granularScopeNames = granularScopes.map((g) => g.scope);
  const allGrantedScopes = new Set([...scopes, ...granularScopeNames]);

  // Ensure mandatory WhatsApp Business management scope is present
  const hasManagementScope = allGrantedScopes.has(
    "whatsapp_business_management"
  );

  if (!hasManagementScope) {
    throw new MetaApiError(
      "OAuth token missing required WhatsApp Business management scope (whatsapp_business_management).",
      { httpStatus: 403, code: "OAUTH_PERMISSION_DENIED", isTransient: false }
    );
  }

  // If expectedWabaId is specified and granular_scopes exist for whatsapp_business_management, verify target_ids
  if (expectedWabaId && expectedWabaId.trim() !== "") {
    const trimmedExpectedWabaId = expectedWabaId.trim();
    for (const gScope of granularScopes) {
      if (
        gScope.scope === "whatsapp_business_management" &&
        Array.isArray(gScope.target_ids) &&
        gScope.target_ids.length > 0
      ) {
        if (!gScope.target_ids.includes(trimmedExpectedWabaId)) {
          throw new MetaApiError(
            `OAuth token granular scopes do not grant access to target WABA (${trimmedExpectedWabaId}).`,
            { httpStatus: 403, code: "OAUTH_PERMISSION_DENIED", isTransient: false }
          );
        }
      }
    }
  }

  return {
    isValid: true,
    appId: String(data.app_id),
    scopes,
    granularScopes,
  };
}

/**
 * Discovers shared WABAs linked to the platform Business Manager.
 * Supports pagination and early exit when wabaIdHint is provided.
 * Uses META_SYSTEM_USER_ACCESS_TOKEN.
 */
export async function discoverSharedWabas(
  businessId: string,
  wabaIdHint?: string
): Promise<DiscoveredWaba[]> {
  const config = getMetaConfig();

  const trimmedHint = wabaIdHint ? wabaIdHint.trim() : undefined;
  const rawWabas = await fetchAllPages<{
    id: string;
    name?: string;
    currency?: string;
    timezone_id?: string;
    message_template_namespace?: string;
  }>(
    `/${businessId}/client_whatsapp_business_accounts`,
    config.systemUserAccessToken,
    { fields: "id,name,currency,timezone_id,message_template_namespace" },
    trimmedHint ? (w) => String(w.id) === trimmedHint : undefined
  );

  return rawWabas.map((w) => ({
    id: String(w.id),
    name: w.name,
    currency: w.currency,
    timezoneId: w.timezone_id,
    messageTemplateNamespace: w.message_template_namespace,
  }));
}

/**
 * Discovers phone numbers associated with a WABA.
 * Supports pagination and early exit when phoneNumberIdHint is provided.
 * Uses META_SYSTEM_USER_ACCESS_TOKEN.
 */
export async function discoverWabaPhoneNumbers(
  wabaId: string,
  phoneNumberIdHint?: string
): Promise<DiscoveredPhoneNumber[]> {
  const config = getMetaConfig();

  const trimmedHint = phoneNumberIdHint ? phoneNumberIdHint.trim() : undefined;
  const rawPhones = await fetchAllPages<{
    id: string;
    display_phone_number: string;
    verified_name?: string;
    quality_rating?: string;
    status?: string;
    code_verification_status?: string;
  }>(
    `/${wabaId}/phone_numbers`,
    config.systemUserAccessToken,
    {
      fields:
        "id,display_phone_number,verified_name,quality_rating,status,code_verification_status",
    },
    trimmedHint ? (p) => String(p.id) === trimmedHint : undefined
  );

  return rawPhones.map((p) => ({
    id: String(p.id),
    displayPhoneNumber: p.display_phone_number,
    verifiedName: p.verified_name,
    qualityRating: p.quality_rating,
    status: p.status,
    codeVerificationStatus: p.code_verification_status,
  }));
}

/**
 * Queries assigned users for a WABA to support reconciliation before POST.
 * Supports pagination to find target system user across pages.
 */
export async function getAssignedUsersForWaba(
  wabaId: string,
  targetUserId?: string,
  targetTask?: string
): Promise<AssignedUser[]> {
  const config = getMetaConfig();

  const rawUsers = await fetchAllPages<{
    id: string;
    name?: string;
    tasks?: string[];
  }>(
    `/${wabaId}/assigned_users`,
    config.systemUserAccessToken,
    { fields: "id,name,tasks" },
    targetUserId
      ? (u) =>
          String(u.id) === targetUserId &&
          (!targetTask || (u.tasks || []).includes(targetTask))
      : undefined
  );

  return rawUsers.map((u) => ({
    id: String(u.id),
    name: u.name,
    tasks: u.tasks || [],
  }));
}

/**
 * Assigns platform system user to WABA with explicit reconciliation check before POST.
 */
export async function assignSystemUserToWaba(
  wabaId: string,
  systemUserId: string,
  task: MetaWabaSystemUserTask
): Promise<{ assigned: boolean; alreadyExisted: boolean }> {
  const config = getMetaConfig();

  // Reconciliation: check if system user already has the required task assigned across all pages
  try {
    const existingAssigned = await getAssignedUsersForWaba(
      wabaId,
      systemUserId,
      task
    );
    const existing = existingAssigned.find((u) => u.id === systemUserId);
    if (existing && existing.tasks.includes(task)) {
      return { assigned: true, alreadyExisted: true };
    }
  } catch {
    // If querying assigned_users fails, proceed to attempt direct assignment
  }

  await metaGraphFetch<{ success: boolean }>({
    method: "POST",
    endpoint: `/${wabaId}/assigned_users`,
    accessToken: config.systemUserAccessToken,
    body: {
      user: systemUserId,
      tasks: [task],
    },
  });

  return { assigned: true, alreadyExisted: false };
}

/**
 * Queries subscribed apps for a WABA to support reconciliation before POST.
 * Supports pagination to find target app subscription across pages.
 */
export async function getWabaSubscriptions(
  wabaId: string,
  targetAppId?: string
): Promise<WabaSubscriptionEntry[]> {
  const config = getMetaConfig();

  const rawSubs = await fetchAllPages<WabaSubscriptionEntry>(
    `/${wabaId}/subscribed_apps`,
    config.systemUserAccessToken,
    {},
    targetAppId
      ? (s) =>
          !s.whatsapp_business_api_data?.id ||
          String(s.whatsapp_business_api_data.id) === targetAppId
      : undefined
  );

  return rawSubs;
}

/**
 * Subscribes platform app to WABA webhooks with explicit reconciliation check before POST.
 */
export async function subscribeAppToWaba(
  wabaId: string
): Promise<{ subscribed: boolean; alreadyExisted: boolean }> {
  const config = getMetaConfig();

  // Reconciliation: check if app is already subscribed across all pages
  try {
    const existingSubs = await getWabaSubscriptions(wabaId, config.appId);
    const alreadySubscribed =
      existingSubs.length > 0 &&
      existingSubs.some((sub) => {
        const appId = sub.whatsapp_business_api_data?.id;
        return !appId || String(appId) === String(config.appId);
      });

    if (alreadySubscribed) {
      return { subscribed: true, alreadyExisted: true };
    }
  } catch {
    // If querying subscriptions fails, proceed to attempt subscription
  }

  await metaGraphFetch<{ success: boolean }>({
    method: "POST",
    endpoint: `/${wabaId}/subscribed_apps`,
    accessToken: config.systemUserAccessToken,
  });

  return { subscribed: true, alreadyExisted: false };
}
