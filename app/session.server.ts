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

  // Check if session is a temporary access pass
  if (session.get("isTempPass")) {
    const expiresAtStr = session.get("expiresAt");
    const passId = session.get("passId");

    const isExpiredByTime = expiresAtStr && new Date() > new Date(expiresAtStr);

    if (isExpiredByTime) {
      throw redirect("/login?expired=true", {
        headers: {
          "Set-Cookie": await sessionStorage.destroySession(session),
        },
      });
    }

    if (passId) {
      const pass = await prisma.temporaryPass.findUnique({ where: { id: passId } });
      if (!pass || !pass.isActive || new Date() > pass.expiresAt) {
        throw redirect("/login?expired=true", {
          headers: {
            "Set-Cookie": await sessionStorage.destroySession(session),
          },
        });
      }
    }
  }

  return session;
}

/**
 * Authenticates using a Temporary Access Pass Code or Share Link.
 */
export async function loginWithTempPass(request: Request, passCodeInput: string) {
  const passCode = passCodeInput.trim();

  const pass = await prisma.temporaryPass.findUnique({
    where: { passCode: passCode },
  });

  if (!pass) {
    return { error: "Invalid temporary access pass code." };
  }

  if (!pass.isActive) {
    return { error: "This access pass has been revoked by the administrator." };
  }

  if (new Date() > pass.expiresAt) {
    return { error: "This temporary access pass has expired." };
  }

  // Increment usage count
  await prisma.temporaryPass.update({
    where: { id: pass.id },
    data: { usedCount: { increment: 1 } },
  });

  const session = await getSession(request);
  session.set("isAuthenticated", true);
  session.set("userRole", "TEMP_PASS");
  session.set("userName", pass.label || `Guest (${pass.passCode})`);
  session.set("isTempPass", true);
  session.set("permission", pass.permission); // "VIEW_ONLY" or "FULL_EDIT"
  session.set("expiresAt", pass.expiresAt.toISOString());
  session.set("passId", pass.id);

  return redirect("/", {
    headers: {
      "Set-Cookie": await sessionStorage.commitSession(session),
    },
  });
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

  // 0. Check if input is a temporary pass code (e.g. TEMP-XXXX)
  if (username.toUpperCase().startsWith("TEMP-") || password.toUpperCase().startsWith("TEMP-")) {
    const code = username.toUpperCase().startsWith("TEMP-") ? username : password;
    const tempRes = await loginWithTempPass(request, code);
    if (tempRes) return tempRes;
  }

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
      session.set("permission", "FULL_ADMIN");
      session.set("isTempPass", false);
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
      session.set("permission", user.role === "FOUNDER" ? "FULL_ADMIN" : "OPERATOR");
      session.set("isTempPass", false);
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

