# Web Push Notifications (P0.1) Environment Configuration

This document describes the required server-side environment variables for Web Push Notifications in Tem Barber.

> [!IMPORTANT]
> The private VAPID key is a **server-only production secret**. It MUST NEVER be prefixed with `NEXT_PUBLIC_`, committed to git, exposed in client bundles, or printed to application logs.

## Required Environment Variables

Placeholders for rollout configuration:

```env
# VAPID Public Key (Safe to expose to authenticated clients via API)
VAPID_PUBLIC_KEY=<required_at_rollout>

# VAPID Private Key (SERVER ONLY - NEVER SHARE OR COMMIT)
VAPID_PRIVATE_KEY=<required_at_rollout>

# VAPID Subject (Must start with https:// or mailto:)
VAPID_SUBJECT=https://app.tembarber.com.br
```

## Security Rules

1. **Server-Only Access**: `VAPID_PRIVATE_KEY` is loaded lazily at runtime by `src/lib/push/web-push.server.ts` on server API routes only.
2. **Client Key Delivery**: The public key will be delivered to authenticated clients by the planned `GET /api/push/config` endpoint in P0.1B.
3. **Identity Stability**: VAPID keys represent stable application server identity. Key rotation invalidates active browser subscriptions and requires client re-subscription.
