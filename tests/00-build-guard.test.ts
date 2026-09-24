/* The suite runs against whatever `target/deploy/earnout.so` was built last,
 * and the SDK encodes against sdk/generated.ts. If either has drifted from
 * the program source (the id changed, or an instruction was added and nobody
 * ran `npm run gen`), every test would fail under a screenful of logs. Say
 * so in one line instead. */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SO = path.resolve(ROOT, "target/deploy/earnout.so");
const IDL = path.resolve(ROOT, "target/idl/earnout.json");
const LIB = path.resolve(ROOT, "programs/earnout/src/lib.rs");
const GEN = path.resolve(ROOT, "sdk/generated.ts");

before(function () {
  for (const file of [SO, IDL]) {
    if (!fs.existsSync(file)) {
      throw new Error(`No ${path.basename(file)}. The suite runs against a built binary. Run:  npm run build:program`);
    }
  }
  const idl = JSON.parse(fs.readFileSync(IDL, "utf8")) as {
    address: string;
    instructions: { name: string; discriminator: number[] }[];
  };
  const declared = /declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/.exec(fs.readFileSync(LIB, "utf8"))?.[1];
  if (declared && declared !== idl.address) {
    throw new Error(`lib.rs declares ${declared} but the IDL says ${idl.address}. Run:  npm run build:program`);
  }
  const gen = fs.existsSync(GEN) ? fs.readFileSync(GEN, "utf8") : "";
  const stale =
    !gen.includes(idl.address) ||
    idl.instructions.some((i) => !gen.includes(`${i.name}: new Uint8Array([${i.discriminator.join(", ")}])`));
  if (stale) {
    throw new Error("sdk/generated.ts does not match the IDL. Run:  npm run gen");
  }
});
