/* The browser side of an Earnout link, for partner apps.
 *
 * An Earnout link redirects to the partner's page with `?eo=<token>`. On
 * that page, call `captureTag()` once: it keeps the token and takes it out
 * of the address bar, so it is not copied into shares or bookmarks. When the
 * user sends the transaction that counts (a deposit, a swap, a mint), add
 * `tagInstructions(pendingTag())` to it, and call `clearTag()` once it
 * confirms.
 *
 *   captureTag();                                   // on page load
 *   const tag = pendingTag();                        // when building the tx
 *   const ixs = [...yours, ...(tag ? tagInstructions(tag) : [])];
 *   // ...send, confirm...
 *   clearTag();
 *
 * Attribution is last click: a newer link replaces an older one. A tag is
 * kept for seven days by default; the settler applies the campaign's own
 * window as well, from the issue time sealed inside the reference.
 *
 * Nothing here throws. Storage that is blocked or full just means no tag,
 * and a transaction without a tag still goes through. */

import { decodeTagToken, type Tag } from "./identity.ts";

export const TAG_PARAM = "eo";
export const DEFAULT_WINDOW_SECS = 7 * 86_400;
const KEY = "earnout:tag";

export type TagStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type Saved = { token: string; savedAt: number };

function defaultStore(): TagStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const nowSecs = () => Math.floor(Date.now() / 1000);

/** Keep the tag from the current URL, if it has a valid one, and remove it
 * from the address bar. Returns the tag it kept, or null. */
export function captureTag(opts: {
  url?: string | URL;
  store?: TagStore | null;
  now?: number;
  replaceUrl?: (url: string) => void;
} = {}): Tag | null {
  try {
    const href = opts.url ?? (typeof location === "undefined" ? null : location.href);
    if (!href) return null;
    const url = new URL(href.toString());
    const token = url.searchParams.get(TAG_PARAM);
    if (!token) return null;

    url.searchParams.delete(TAG_PARAM);
    const replace =
      opts.replaceUrl ??
      ((u: string) => {
        if (typeof history !== "undefined") history.replaceState(history.state, "", u);
      });
    replace(url.toString());

    const tag = decodeTagToken(token);
    if (!tag) return null;
    const store = opts.store === undefined ? defaultStore() : opts.store;
    const saved: Saved = { token, savedAt: opts.now ?? nowSecs() };
    store?.setItem(KEY, JSON.stringify(saved));
    return tag;
  } catch {
    return null;
  }
}

type PendingOpts = { store?: TagStore | null; now?: number; windowSecs?: number };

/** The kept tag, if there is one and it is still inside the window. */
export function pendingTag(opts: PendingOpts = {}): Tag | null {
  return pendingTagEntry(opts)?.tag ?? null;
}

/** The kept tag with when it was saved and when it lapses, in unix seconds. */
export function pendingTagEntry(opts: PendingOpts = {}): { tag: Tag; savedAt: number; expiresAt: number } | null {
  const store = opts.store === undefined ? defaultStore() : opts.store;
  const windowSecs = opts.windowSecs ?? DEFAULT_WINDOW_SECS;
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    const age = (opts.now ?? nowSecs()) - saved.savedAt;
    if (!(age >= 0 && age <= windowSecs)) {
      store?.removeItem(KEY);
      return null;
    }
    const tag = decodeTagToken(saved.token);
    return tag ? { tag, savedAt: saved.savedAt, expiresAt: saved.savedAt + windowSecs } : null;
  } catch {
    return null;
  }
}

/** Forget the kept tag. Call once the tagged transaction confirms; a
 * reference only ever counts once, so there is no reason to keep it. */
export function clearTag(opts: { store?: TagStore | null } = {}): void {
  const store = opts.store === undefined ? defaultStore() : opts.store;
  try {
    store?.removeItem(KEY);
  } catch {
    // Storage blocked; nothing was kept.
  }
}
