/**
 * 24/7 Render Keep-Awake Self-Pinger Engine
 * Runs a background timer every 13 minutes in production to keep Render active.
 * Queries /ping (0ms, zero database overhead).
 */

declare global {
  var __renderKeepAwakeTimer__: NodeJS.Timeout | undefined;
}

export function initKeepAwake() {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  if (global.__renderKeepAwakeTimer__) {
    return; // Singleton already initialized
  }

  const PING_INTERVAL_MS = 13 * 60 * 1000; // 13 minutes (Render sleeps after 15 min inactivity)
  const TARGET_URL = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/ping`
    : "https://dreamline-logistics.onrender.com/ping";

  console.log(`[Keep-Awake] Initialized 24/7 self-pinger for ${TARGET_URL} (every 13m)`);

  global.__renderKeepAwakeTimer__ = setInterval(async () => {
    try {
      const res = await fetch(TARGET_URL, {
        headers: { "User-Agent": "Dreamline-Internal-KeepAlive/1.0" },
      });
      console.log(`[Keep-Awake Ping] ${new Date().toISOString()} -> Status: ${res.status}`);
    } catch (err: any) {
      console.warn(`[Keep-Awake Ping Warning] ${err.message}`);
    }
  }, PING_INTERVAL_MS);
}

