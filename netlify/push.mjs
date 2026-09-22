// Entre Nous · envía la notificación push cuando alguien escribe.
// El mensaje va cifrado: aquí solo se sabe quién escribió, nunca qué dice.
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, FieldPath } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return reply(405, { error: "método no permitido" });

  // 1) ¿Quién envía? Se verifica con su sesión de Firebase.
  let uid;
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    uid = (await getAuth().verifyIdToken(token)).uid;
  } catch { return reply(401, { error: "sesión inválida" }); }

  const { chatId, msgId } = await req.json().catch(() => ({}));
  const okId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
  if (!okId(chatId) || !okId(msgId)) return reply(400, { error: "datos inválidos" });

  const db = getFirestore();
  const msgRef = db.doc(`chats/${chatId}/messages/${msgId}`);

  // 2) El mensaje debe existir, ser suyo, reciente y no haber sido avisado antes.
  const msgSnap = await msgRef.get();
  if (!msgSnap.exists) return reply(404, { error: "no existe" });
  const msg = msgSnap.data();
  if (msg.by !== uid) return reply(403, { error: "no autorizado" });
  if (msg.sys || msg.pushed) return reply(200, { sent: 0 });
  const at = msg.at && msg.at.toMillis ? msg.at.toMillis() : 0;
  if (Date.now() - at > 5 * 60 * 1000) return reply(200, { sent: 0 });
  await msgRef.update({ pushed: true });

  // 3) Debe ser integrante del chat.
  const chatSnap = await db.doc(`chats/${chatId}`).get();
  if (!chatSnap.exists) return reply(404, { error: "no existe" });
  const chat = chatSnap.data();
  if (!(chat.members || []).includes(uid)) return reply(403, { error: "no autorizado" });

  const senderSnap = await db.doc(`users/${uid}`).get();
  const sender = senderSnap.exists ? senderSnap.data() : {};
  const who = sender.name || "@" + (sender.username || "alguien");
  const title = chat.isGroup ? (chat.title || "Grupo") : who;
  const body = chat.isGroup ? `${who}: 🔒 mensaje nuevo` : "🔒 Te envió un mensaje";

  // 4) Avisa a cada integrante en todos sus dispositivos.
  let sent = 0;
  for (const member of chat.members.filter((m) => m !== uid)) {
    const ref = db.doc(`push/${member}`);
    const snap = await ref.get();
    const tokens = Object.entries((snap.exists && snap.data().tokens) || {});
    if (!tokens.length) continue;
    const res = await getMessaging().sendEach(tokens.map(([token, info]) => {
      const origin = (info && info.origin) || "";
      return {
        token,
        data: { chatId },
        webpush: {
          headers: { Urgency: "high", TTL: "86400" },
          notification: {
            title, body, tag: chatId, renotify: true,
            icon: origin + "/icon-192.png", badge: origin + "/icon-192.png"
          },
          fcmOptions: { link: origin + "/?chat=" + chatId }
        }
      };
    }));
    sent += res.successCount;
    // limpia dispositivos que ya no existen
    for (let i = 0; i < res.responses.length; i++) {
      const r = res.responses[i];
      const code = (r.error && r.error.code) || "";
      if (!r.success && (code.includes("not-registered") || code.includes("invalid-registration-token"))) {
        await ref.update(new FieldPath("tokens", tokens[i][0]), FieldValue.delete()).catch(() => {});
      }
    }
  }
  return reply(200, { sent });
};

export const config = { path: "/api/push" };
