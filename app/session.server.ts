import { createCookieSessionStorage, redirect } from "react-router";

// Load environment credentials or use secure defaults
const SESSION_SECRET = process.env.SESSION_SECRET || "dreamline-super-secret-key-2026-xyz-abc";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "dreamline2026";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__dreamline_session",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secrets: [SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7 days session retention
  },
});

export async function getSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  return sessionStorage.getSession(cookie);
}

/**
 * Enforces the administrative session check.
 * If not authenticated, throws a hard redirect to the login gate.
 */
export async function requireAdmin(request: Request) {
  const session = await getSession(request);
  const isAuthenticated = session.get("isAuthenticated");

  if (!isAuthenticated) {
    throw redirect("/login");
  }

  return session;
}

/**
 * Authenticates the admin credentials.
 * If successful, commits the cookie and redirects to the index route.
 */
export async function loginAdmin(request: Request, usernameInput: string, passwordInput: string) {
  if (
    usernameInput.trim().toLowerCase() === ADMIN_USERNAME.toLowerCase() &&
    passwordInput === ADMIN_PASSWORD
  ) {
    const session = await getSession(request);
    session.set("isAuthenticated", true);
    return redirect("/", {
      headers: {
        "Set-Cookie": await sessionStorage.commitSession(session),
      },
    });
  }
  return null;
}

/**
 * Logs out the administrator, destroying the session.
 */
export async function logoutAdmin(request: Request) {
  const session = await getSession(request);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
    },
  });
}
