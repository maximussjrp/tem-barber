/* eslint-disable no-restricted-globals */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const TARGET_ALLOWLIST = {
  MEMBER_AGENDA: "/member/agenda",
  CLIENT_APPOINTMENTS: "/minha-conta",
  WAITLIST: "/minha-conta",
  STAFF_WAITLIST: "/member/fila",
  ROOT: "/",
};

function resolveTargetUrl(targetKey) {
  if (typeof targetKey === "string" && Object.prototype.hasOwnProperty.call(TARGET_ALLOWLIST, targetKey)) {
    return TARGET_ALLOWLIST[targetKey];
  }
  return TARGET_ALLOWLIST.ROOT;
}

function parsePayload(event) {
  const fallback = {
    title: "Tem Barber",
    body: "Você tem uma nova atualização.",
    tag: "tem-barber-notification",
    targetKey: "ROOT",
    targetPath: TARGET_ALLOWLIST.ROOT,
  };

  if (!event.data) {
    return fallback;
  }

  try {
    const json = event.data.json();
    if (!json || typeof json !== "object" || json.v !== 1) {
      return fallback;
    }

    if (typeof json.title !== "string" || json.title.trim().length === 0 || json.title.trim().length > 80) {
      return fallback;
    }

    if (typeof json.body !== "string" || json.body.trim().length === 0 || json.body.trim().length > 180) {
      return fallback;
    }

    if (typeof json.tag !== "string" || json.tag.trim().length === 0 || json.tag.trim().length > 128) {
      return fallback;
    }

    if (typeof json.target !== "string" || !Object.prototype.hasOwnProperty.call(TARGET_ALLOWLIST, json.target)) {
      return fallback;
    }

    const title = json.title.trim();
    const body = json.body.trim();
    const tag = json.tag.trim();
    const targetKey = json.target;
    const targetPath = TARGET_ALLOWLIST[targetKey];

    return { title, body, tag, targetKey, targetPath };
  } catch {
    return fallback;
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePayload(event);
  const options = {
    body: payload.body,
    tag: payload.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      targetKey: payload.targetKey,
    },
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const rawKey = event.notification.data && event.notification.data.targetKey;
  const relativePath = resolveTargetUrl(rawKey);

  let targetUrl;
  try {
    const parsed = new URL(relativePath, self.location.origin);
    if (parsed.origin !== self.location.origin || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      targetUrl = new URL(TARGET_ALLOWLIST.ROOT, self.location.origin).href;
    } else {
      targetUrl = parsed.href;
    }
  } catch {
    targetUrl = new URL(TARGET_ALLOWLIST.ROOT, self.location.origin).href;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      for (const client of windowClients) {
        if ("focus" in client && "navigate" in client) {
          return client.focus().then(() => client.navigate(targetUrl));
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
