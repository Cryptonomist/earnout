import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE_PROFILE,
  COOKIE_STATE,
  COOKIE_VERIFIER,
  PROFILE_TTL_SECS,
  readProfile,
  RETURN_PATH,
  sealProfile,
  xConfig,
} from "@/server/x-auth";

export const dynamic = "force-dynamic";

/* Step two: X sends them back.
 *
 * The profile is read here and carried onward in a signed cookie, because
 * the chain is what records the link and only the wallet can sign that. So
 * this ends with a redirect to the creator hub, where the browser asks the
 * wallet to sign (api/x/link builds that transaction). */
export async function GET(req: NextRequest) {
  const cfg = xConfig();
  const back = new URL(RETURN_PATH, req.nextUrl.origin);
  if (!cfg) return fail(back, "X sign-in is not configured on this deployment");

  const error = req.nextUrl.searchParams.get("error");
  if (error) return fail(back, error === "access_denied" ? "Sign-in cancelled" : error);

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get(COOKIE_STATE)?.value;
  const verifier = req.cookies.get(COOKIE_VERIFIER)?.value;
  if (!code || !state || !expected || !verifier || state !== expected) {
    return fail(back, "That sign-in did not match the one this browser started");
  }

  let profile;
  try {
    profile = await readProfile(cfg, code, verifier, req.nextUrl.origin);
  } catch (e) {
    return fail(back, e instanceof Error ? e.message : "X sign-in failed");
  }

  back.searchParams.set("x", "ok");
  const res = NextResponse.redirect(back);
  res.cookies.delete({ name: COOKIE_STATE, path: "/api/x" });
  res.cookies.delete({ name: COOKIE_VERIFIER, path: "/api/x" });
  res.cookies.set(COOKIE_PROFILE, sealProfile(cfg.clientSecret, profile), {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: PROFILE_TTL_SECS,
  });
  return res;
}

function fail(back: URL, message: string) {
  back.searchParams.set("x", "error");
  back.searchParams.set("message", message);
  return NextResponse.redirect(back);
}
