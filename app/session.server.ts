import { createCookieSessionStorage, redirect } from "react-router";
import crypto from "crypto";
import { prisma } from "./db.server";

// Dynamic session secret for cookie signing
const SESSION_SECRET = process.env.SESSION_SECRET || "dreamline-super-secret-key-2026-xyz-abc";

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
 * Encrypts/hashes the administrative access code using secure SHA-256 algorithm.
 */
export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

/**
 * Ensures the target administrative credentials exist in the secure database.
 * If empty, automatically creates the default administrator profile.
 */
async function ensureAdminExists() {
  const count = await prisma.adminCredential.count();
  if (count === 0) {
    await prisma.adminCredential.create({
      data: {
        username: "sumit@6969",
        passwordHash: hashPassword("sumitdream6969"),
      },
    });
    console.log("🌱 Admin credentials seeded in database: sumit@6969");
  }
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
 * Authenticates the admin credentials against the secure Neon PostgreSQL database.
 * If successful, commits the cookie and redirects to the index route.
 */
export async function loginAdmin(request: Request, usernameInput: string, passwordInput: string) {
  await ensureAdminExists();

  const username = usernameInput.trim();
  const password = passwordInput; // Keep exact characters

  console.log(`🔑 Login Attempt: "${username}"`);

  // 1. Try AdminCredential
  const credential = await prisma.adminCredential.findUnique({
    where: { username: username.toLowerCase() },
  });

  if (credential) {
    const computedHash = hashPassword(password);
    if (credential.passwordHash === computedHash) {
      console.log(`✅ Auth Success: Admin "${username}" matched. Session committed.`);
      const session = await getSession(request);
      session.set("isAuthenticated", true);
      session.set("userRole", "ADMIN");
      session.set("userName", credential.username);
      return redirect("/", {
        headers: {
          "Set-Cookie": await sessionStorage.commitSession(session),
        },
      });
    } else {
      console.warn(`❌ Auth Failure: Password mismatch for admin "${username}".`);
      return null;
    }
  }

  // 2. Try User (Driver or Founder)
  const user = await prisma.user.findUnique({
    where: { phone: username },
  });

  if (user) {
    if (!user.loginEnabled && user.role !== "FOUNDER") {
      console.warn(`❌ Auth Failure: Operator login disabled for phone "${username}".`);
      return { error: "Login disabled for this account. Please contact administrator." };
    }

    if (!user.passwordHash) {
      console.warn(`❌ Auth Failure: No password set for operator phone "${username}".`);
      return { error: "No login password set. Please contact administrator." };
    }

    const computedHash = hashPassword(password);
    if (user.passwordHash === computedHash) {
      console.log(`✅ Auth Success: Operator "${user.name}" matched. Session committed.`);
      const session = await getSession(request);
      session.set("isAuthenticated", true);
      session.set("userRole", user.role); // "DRIVER" or "FOUNDER"
      session.set("userName", user.name);
      session.set("userPhone", user.phone);
      session.set("userId", user.id);
      return redirect("/", {
        headers: {
          "Set-Cookie": await sessionStorage.commitSession(session),
        },
      });
    } else {
      console.warn(`❌ Auth Failure: Password mismatch for operator phone "${username}".`);
      return null;
    }
  }

  console.warn(`❌ Auth Failure: Username/Phone "${username}" not found in database.`);
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
