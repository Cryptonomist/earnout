/* Where the settler keeps its ledger and publishes its report.
 *
 * With SUPABASE_URL and SUPABASE_SECRET_KEY set, both live in the earnout
 * Supabase project: `ledgers` (private, service role only) and `reports`
 * (public read, counts only). Saving a ledger is conditional on the version
 * it was read at, so two settler runs cannot overwrite each other; the
 * loser's pass fails and the next one starts from the winner's state.
 *
 * Without them, the ledger is a file under var/settler and the report goes
 * nowhere, which is how the settler first ran. A ledger that exists only as
 * a file is picked up by the database store on its first load. */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { PublicReport } from "../src/lib/report.ts";
import { emptyLedger, type Ledger } from "./core.ts";

export type Loaded = { ledger: Ledger; version: number };

export interface LedgerStore {
  readonly kind: string;
  load(campaign: string): Promise<Loaded>;
  /** Returns the version now stored. */
  save(ledger: Ledger, version: number): Promise<number>;
  publish(report: PublicReport): Promise<void>;
}

function readFile(dir: string, campaign: string): Ledger | null {
  const p = path.join(dir, `${campaign}.json`);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Ledger) : null;
}

export function fileStore(dir: string): LedgerStore {
  return {
    kind: `file (${dir})`,
    async load(campaign) {
      return { ledger: readFile(dir, campaign) ?? emptyLedger(campaign), version: 0 };
    },
    async save(ledger, version) {
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, `${ledger.campaign}.json`);
      fs.writeFileSync(`${p}.tmp`, JSON.stringify(ledger, null, 2) + "\n");
      fs.renameSync(`${p}.tmp`, p);
      return version + 1;
    },
    async publish() {},
  };
}

export function supabaseStore(url: string, secretKey: string, cluster: string, legacyDir: string): LedgerStore {
  const db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    kind: `supabase (${new URL(url).host})`,
    async load(campaign) {
      const { data, error } = await db.from("ledgers").select("doc, version").eq("campaign", campaign).maybeSingle();
      if (error) throw new Error(`load ledger: ${error.message}`);
      if (data) return { ledger: data.doc as Ledger, version: data.version as number };
      return { ledger: readFile(legacyDir, campaign) ?? emptyLedger(campaign), version: 0 };
    },
    async save(ledger, version) {
      const { data, error } = await db.rpc("save_ledger", {
        p_campaign: ledger.campaign,
        p_cluster: cluster,
        p_doc: ledger,
        p_version: version,
      });
      if (error) throw new Error(`save ledger: ${error.message}`);
      return data as number;
    },
    async publish(report) {
      const { error } = await db
        .from("reports")
        .upsert({ campaign: report.campaign, cluster: report.cluster, name: report.name, data: report, updated_at: report.updatedAt });
      if (error) throw new Error(`publish report: ${error.message}`);
    },
  };
}

export function storeFromEnv(cluster: string, dir: string): LedgerStore {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? supabaseStore(url, key, cluster, dir) : fileStore(dir);
}
