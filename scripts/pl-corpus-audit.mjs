#!/usr/bin/env node
// Read-only audit: 14 oficjalnych polskich źródeł EUR-Lex dla istniejącego korpusu.
// NIC nie pobiera i nie zapisuje; generuje listę źródeł do osobnego procesu ETL.
// Uwaga: URL stały CELEX nie dowodzi, że treść jest dostępna lub zaktualizowana.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  process.env.EU_COMPLIANCE_DB,
  join(root, "data", "regulations.db"),
  join(homedir(), ".matematic", "cache", "eu-compliance", "regulations.db"),
].filter(Boolean);
const file = candidates.find(x => existsSync(x));
if (!file) {
  console.error("Brak regulations.db; ustaw EU_COMPLIANCE_DB lub pobierz korpus przed audytem.");
  process.exit(2);
}
const ids = ["GDPR","AI_ACT","DORA","NIS2","EIDAS2","CRA","DSA","DMA",
             "DATA_ACT","DGA","LED","EPRIVACY","CYBERSECURITY_ACT","CER"];
const db = new DatabaseSync(resolve(file), { readOnly: true });
let records;
try {
  const find = db.prepare("SELECT regulation, celex_id FROM source_registry WHERE regulation = ?");
  records = ids.map(id => {
    const r = find.get(id);
    if (typeof r?.celex_id !== "string" || !/^[A-Z0-9/\-]+$/.test(r.celex_id)) {
      throw new Error("Nieprawidłowy lub brak CELEX dla: " + id);
    }
    const base = "https://eur-lex.europa.eu/legal-content/PL/TXT/";
    const query = "?uri=CELEX:" + encodeURIComponent(r.celex_id);
    return {
      regulation: id, celex: r.celex_id,
      typ: r.celex_id.startsWith("0") ? "tekst skonsolidowany z datą" : "akt bazowy / zweryfikuj nowelizacje",
      polski_html: base + "HTML/" + query,
      polski_xml: base + "XML/" + query,
      jezyk_zadany: "PL",
      tresc_pl_zweryfikowana: false,
      aktualny_stan_prawny_zweryfikowany: false,
    };
  });
} finally {
  db.close();
}
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ liczba: records.length, status: "linki wygenerowane, pliki niepobrane", records }, null, 2));
} else {
  console.log("# Audyt źródeł dla polskiego korpusu EU — bez pobierania\n");
  console.log("Uwaga: URL nie potwierdza dostępności PL ani aktualności prawa. ETL ma sprawdzić wersję urzędową, XML, artykuły, checksum i historię zmian.\n");
  console.log("| Regulacja | CELEX | Rodzaj | XML PL |");
  console.log("|---|---|---|---|");
  for (const r of records) console.log(`| ${r.regulation} | ${r.celex} | ${r.typ} | ${r.polski_xml} |`);
}
