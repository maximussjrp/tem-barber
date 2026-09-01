export async function cleanupCurrentPushSubscriptionBeforeLogout(
  timeoutMs = 2000
): Promise<void> {
  if (typeof window === "undefined" || !("navigator" in window) || !("serviceWorker" in navigator)) {
    return;
  }

  const cleanupPromise = (async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || !registration.pushManager) {
        return;
      }

      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        return;
      }

      const serialized = subscription.toJSON();
      if (serialized.endpoint && serialized.keys?.p256dh && serialized.keys?.auth) {
        try {
          await fetch("/api/push/unsubscribe", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              endpoint: serialized.endpoint,
              keys: {
                p256dh: serialized.keys.p256dh,
                auth: serialized.keys.auth,
              },
            }),
          });
        } catch {
          // Ignore server detach failure, proceed to browser unsubscribe
        }
      }

      try {
        await subscription.unsubscribe();
      } catch {
        // Ignore browser unsubscribe failure
      }
    } catch {
      // Ignore any overall cleanup errors
    }
  })();

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });

  await Promise.race([cleanupPromise, timeoutPromise]);
}
