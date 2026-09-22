/* Entre Nous · service worker: recibe las notificaciones push con la app cerrada */
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
);
firebase.initializeApp({
  apiKey: "AIzaSyB0hor07QR7fRV3zA5FUskk2eRnb9ZN2bo",
  authDomain: "entre-nous-bca2c.firebaseapp.com",
  projectId: "entre-nous-bca2c",
  storageBucket: "entre-nous-bca2c.firebasestorage.app",
  messagingSenderId: "786938531220",
  appId: "1:786938531220:web:438733f792c9d856db5381"
});
firebase.messaging(); // muestra sola la notificación push y abre el chat al tocarla

// avisos creados por la propia app (cuando está abierta en segundo plano)
self.addEventListener("notificationclick", e => {
  const chatId = e.notification.data && e.notification.data.chatId;
  if (!chatId) return;               // los avisos push los maneja Firebase
  e.notification.close();
  e.waitUntil((async () => {
    const url = new URL("./?chat=" + encodeURIComponent(chatId), self.registration.scope).href;
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { await c.focus(); if ("navigate" in c) return c.navigate(url); return; } }
    return clients.openWindow(url);
  })());
});
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
