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

/** Why a sign-in did not end in a profile. The hub turns each into a
 * sentence of its own; nothing X or a visitor wrote is ever shown. */
export type XSignInProblem = "unconfigured" | "cancelled" | "refused" | "mismatch" | "exchange";

/* Step two: X sends them back.
 *
 * The profile is read here and carried onward in a signed cookie, because
 * the chain is what records the link and only the wallet can sign that. So
 * this ends with a redirect to the influencer hub, where the browser asks the
 * wallet to sign (api/x/link builds that transaction). */
export async function GET(req: NextRequest) {
  const cfg = xConfig();
  const back = new URL(RETURN_PATH, req.nextUrl.origin);
  if (!cfg) return fail(back, "unconfigured");

  const error = req.nextUrl.searchParams.get("error");
  if (error) return fail(back, error === "access_denied" ? "cancelled" : "refused");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get(COOKIE_STATE)?.value;
  const verifier = req.cookies.get(COOKIE_VERIFIER)?.value;
  if (!code || !state || !expected || !verifier || state !== expected) return fail(back, "mismatch");

  let profile;
  try {
    profile = await readProfile(cfg, code, verifier, req.nextUrl.origin);
  } catch (e) {
    console.error(`[x/callback] ${(e as Error).message}`);
    return fail(back, "exchange");
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

function fail(back: URL, problem: XSignInProblem) {
  back.searchParams.set("x", "error");
  back.searchParams.set("reason", problem);
  return NextResponse.redirect(back);
}
