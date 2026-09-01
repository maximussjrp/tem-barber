import { NextResponse } from "next/server";
import {
  getAuthenticatedPushSession,
  isPushEligibleAuthLevel,
} from "@/lib/push/push-api.server";
import { configureWebPush, getVapidConfig } from "@/lib/push/web-push.server";

export async function GET() {
  const { user } = await getAuthenticatedPushSession();

  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  if (!isPushEligibleAuthLevel(user.authLevel)) {
    return NextResponse.json(
      { error: "PUSH_AUTH_LEVEL_NOT_ELIGIBLE" },
      { status: 403 }
    );
  }

  try {
    configureWebPush();
  } catch {
    return NextResponse.json(
      { error: "PUSH_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  let config;
  try {
    config = getVapidConfig();
  } catch {
    return NextResponse.json(
      { error: "PUSH_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    publicKey: config.publicKey,
  });
}
