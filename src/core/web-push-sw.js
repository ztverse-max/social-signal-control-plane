export const WEB_PUSH_SW_SOURCE = `self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });
    const hasVisibleClient = clientList.some((client) => client.visibilityState === "visible");

    if (hasVisibleClient) {
      return;
    }

    await self.registration.showNotification(payload.title || "检测到新消息", {
      body: payload.body || "",
      tag: payload.tag,
      data: {
        url: payload.url || "/",
        tag: payload.tag
      }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of clientList) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(targetUrl);
        }
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});`;
