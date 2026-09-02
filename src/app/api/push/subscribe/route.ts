import { NextResponse } from "next/server";
import {
  getAuthenticatedPushSession,
  isPushEligibleAuthLevel,
  validateCanonicalOrigin,
  reconcileServerSubscription,
} from "@/lib/push/push-api.server";
import { parseSubscribeBody } from "@/lib/push/subscription-payload";

export async function POST(req: Request) {
  const rawContentType = req.headers.get("content-type") || "";
  const mediaType = rawContentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  const { user } = await getAuthenticatedPushSession();
  if (!user || !user.id) {
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

  const originCheck = validateCanonicalOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json(
      { error: originCheck.errorCode },
      { status: originCheck.statusCode }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  const payload = parseSubscribeBody(body);
  if (!payload) {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  try {
    const result = await reconcileServerSubscription(user.id, payload);
    if (result.conflict) {
      return NextResponse.json(
        { error: "SUBSCRIPTION_ENDPOINT_CONFLICT" },
        { status: 409 }
      );
    }

    if (!result.success) {
      return NextResponse.json(
        { error: "INTERNAL_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, deviceLinked: result.deviceLinked });
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
