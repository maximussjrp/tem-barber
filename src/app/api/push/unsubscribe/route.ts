import { NextResponse } from "next/server";
import {
  getAuthenticatedPushSession,
  isPushDeleteEligibleAuthLevel,
  validateCanonicalOrigin,
  detachServerSubscription,
} from "@/lib/push/push-api.server";
import { parseUnsubscribeBody } from "@/lib/push/subscription-payload";

export async function DELETE(req: Request) {
  const rawContentType = req.headers.get("content-type") || "";
  const mediaType = rawContentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  const { user } = await getAuthenticatedPushSession();
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  if (!isPushDeleteEligibleAuthLevel(user.authLevel)) {
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

  const payload = parseUnsubscribeBody(body);
  if (!payload) {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  try {
    await detachServerSubscription(payload);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
