import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "nutribot_session";

export type SessionUser = {
  name: string;
};

function getSecret() {
  const secret = process.env.AUTH_SECRET || process.env.APP_PASSWORD || process.env.APP_USER_PASSWORDS;
  if (!secret) {
    throw new Error("Set AUTH_SECRET before using login.");
  }
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function getAllowedUsers() {
  return (process.env.APP_USERS || "Eric,User 2")
    .split(",")
    .map((user) => user.trim())
    .filter(Boolean);
}

function getUserPasswords() {
  const raw = process.env.APP_USER_PASSWORDS;
  if (!raw) {
    return new Map<string, string>();
  }

  return new Map(
    raw
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [name, ...passwordParts] = pair.split(":");
        return [name.trim(), passwordParts.join(":").trim()] as const;
      })
      .filter(([name, password]) => Boolean(name && password))
  );
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) {
    return null;
  }

  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.name !== "string" || !getAllowedUsers().includes(data.name)) {
      return null;
    }
    return { name: data.name };
  } catch {
    return null;
  }
}

export async function createSession(name: string, password: string) {
  const userPasswords = getUserPasswords();
  const expectedPassword = userPasswords.get(name) || process.env.APP_PASSWORD;
  if (!expectedPassword) {
    return { ok: false, error: "Login password is not configured." };
  }
  if (!getAllowedUsers().includes(name) || password !== expectedPassword) {
    return { ok: false, error: "Invalid login." };
  }

  const payload = Buffer.from(JSON.stringify({ name }), "utf8").toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  return { ok: true };
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
