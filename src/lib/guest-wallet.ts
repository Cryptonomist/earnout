/* A guest wallet, for the devnet demo only.
 *
 * A judge with no Solana wallet, or with one set to mainnet and no devnet
 * SOL, would otherwise spend five minutes on setup before their first
 * deposit. This is a Wallet Standard wallet that lives in the page: the
 * first time it is chosen it makes a key and keeps it in this browser's
 * localStorage, so it survives a reload, and the demo faucet funds it. It
 * then appears in the wallet list like any installed wallet.
 *
 * IT IS NOT A WALLET FOR ANYTHING OF VALUE. The key sits in plain
 * localStorage, readable by any script this origin runs, and is gone if the
 * browser's storage is cleared. It only ever signs for devnet, and the site
 * offers it only on the demo, never to a creator, whose wallet holds their
 * earnings and their verified X identity.
 *
 * Registration follows the Wallet Standard handshake: announce the wallet
 * now, and again whenever an app says it is ready. */

import {
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  getTransactionDecoder,
  getTransactionEncoder,
  signBytes,
  type Address,
  type SignatureBytes,
} from "@solana/kit";

export const GUEST_WALLET_NAME = "Guest wallet (devnet)";
const STORAGE_KEY = "earnout.guest-wallet.v1";
const CHAINS = ["solana:devnet"] as const;

const ICON =
  "data:image/svg+xml;base64," +
  (typeof btoa === "function"
    ? btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#16150f"/><path d="M7 4h10a1 1 0 0 1 1 1v14.5l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2V5a1 1 0 0 1 1-1Z" fill="#f4f2eb"/><path d="m9 11.5 2 2 4-4" fill="none" stroke="#0b7349" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      )
    : "");

type Account = {
  address: Address;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
  label: string;
  icon: string;
};

type Keys = { keyPair: CryptoKeyPair; account: Account };

/** The stored seed, or a new one, as the key pair and its account. */
async function loadOrCreate(): Promise<Keys> {
  let seed: Uint8Array | null = null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) seed = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  } catch {
    // Storage blocked: a guest wallet for this page only.
  }
  if (!seed || seed.length !== 32) {
    seed = crypto.getRandomValues(new Uint8Array(32));
    try {
      localStorage.setItem(STORAGE_KEY, btoa(String.fromCharCode(...seed)));
    } catch {
      // As above: it still works until the page closes.
    }
  }
  const keyPair = await createKeyPairFromPrivateKeyBytes(seed);
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  return {
    keyPair,
    account: { address, publicKey, chains: CHAINS, features: ["solana:signTransaction"], label: "Guest", icon: ICON },
  };
}

type ChangeListener = (props: { accounts: readonly Account[] }) => void;

function makeWallet() {
  let keys: Keys | null = null;
  let accounts: Account[] = [];
  const listeners = new Set<ChangeListener>();
  const changed = () => listeners.forEach((l) => l({ accounts }));

  const wallet = {
    version: "1.0.0" as const,
    name: GUEST_WALLET_NAME,
    icon: ICON,
    chains: CHAINS,
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          keys ??= await loadOrCreate();
          accounts = [keys.account];
          changed();
          return { accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        // The key stays stored: connecting again brings back the same wallet.
        disconnect: async () => {
          accounts = [];
          changed();
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event: string, listener: ChangeListener) => {
          if (event !== "change") return () => {};
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0] as const,
        signTransaction: async (...inputs: { transaction: Uint8Array; account: Account; chain?: string }[]) => {
          if (!keys || !accounts.length) throw new Error("The guest wallet is not connected");
          const k = keys;
          return Promise.all(
            inputs.map(async ({ transaction, chain }) => {
              if (chain && chain !== "solana:devnet") throw new Error("The guest wallet signs for devnet only");
              const tx = getTransactionDecoder().decode(transaction);
              if (!(k.account.address in tx.signatures)) throw new Error("This transaction does not ask the guest wallet to sign");
              const signature: SignatureBytes = await signBytes(k.keyPair.privateKey, tx.messageBytes);
              const signed = { ...tx, signatures: { ...tx.signatures, [k.account.address]: signature } };
              return { signedTransaction: new Uint8Array(getTransactionEncoder().encode(signed)) };
            }),
          );
        },
      },
    },
  };
  return wallet;
}

let registered = false;

/** Offer the guest wallet on this page. Safe to call more than once. */
export function registerGuestWallet(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  const wallet = makeWallet();
  const callback = ({ register }: { register: (w: unknown) => unknown }) => register(wallet);
  try {
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: callback }));
  } catch {
    // An app that is not listening yet will ask below.
  }
  window.addEventListener("wallet-standard:app-ready", ((e: CustomEvent) => callback(e.detail)) as EventListener);
}
