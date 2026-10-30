#!/usr/bin/env node
// Offline regresja scalonego modułu live UE na fixtures (zapisane odpowiedzi live z 2026-07-08) -
// query buildery + parsowanie citations. Zero sieci. Wymaga `npm run build`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

import {
    CJEU_TYPES,
    RESOURCE_TYPES,
    searchByCelexQuery,
    searchByDateRangeQuery,
    searchCjeuByEcliQuery,
    searchCjeuQuery,
} from "../dist/live-eu-queries.js";
import {
    buildCitations,
    buildGdprhubCitations,
    formatGdprhubRows,
    formatRows,
    uniqueRows,
    GDPRHUB_LICENSE,
    gdprhubPageUrl,
} from "../dist/live-eu-format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
    JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf-8"));

let passed = 0;
function test(name, fn) {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
}

// --- query buildery -------------------------------------------------------

test("ORDER type URI to .../ORDER, nie .../ORDER_CJ (cichy no-op fix)", () => {
    assert.equal(
        RESOURCE_TYPES.ORDER,
        "http://publications.europa.eu/resource/authority/resource-type/ORDER",
    );
    assert.ok(!Object.values(RESOURCE_TYPES).some((u) => u.endsWith("/ORDER_CJ")));
});

test("search_cjeu bez filtra obejmuje JUDG + ORDER + OPIN_AG", () => {
    const q = searchCjeuQuery(null, null, null, null, "POL", 20);
    for (const t of CJEU_TYPES) assert.ok(q.includes(`<${RESOURCE_TYPES[t]}>`));
});

test("search_cjeu z document_type zaweza do jednego typu", () => {
    const q = searchCjeuQuery(null, null, "OPIN_AG", null, "POL", 20);
    assert.ok(q.includes(`<${RESOURCE_TYPES.OPIN_AG}>`));
    assert.ok(!q.includes(`<${RESOURCE_TYPES.JUDG}>`));
    assert.ok(!q.includes(`<${RESOURCE_TYPES.ORDER}>`));
});

test("search_cjeu z keyword dodaje CONTAINS na tytule (lowercase)", () => {
    const q = searchCjeuQuery(null, null, "JUDG", "Personal Data", "ENG", 5);
    assert.ok(q.includes('CONTAINS(LCASE(STR(?title)), "personal data")'));
    assert.ok(!q.includes("OPTIONAL {\n    ?expr")); // tytul wymagany przy keyword
});

test("search_cjeu_by_ecli uzywa STR() (ECLI to xsd:string literal)", () => {
    const q = searchCjeuByEcliQuery("ECLI:EU:C:2020:559", "POL");
    assert.ok(q.includes('FILTER(STR(?ecli) = "ECLI:EU:C:2020:559")'));
});

test("query buildery eskapuja cudzyslowy i backslashe", () => {
    const q = searchCjeuByEcliQuery('EC"LI\\x', "POL");
    assert.ok(q.includes('EC\\"LI\\\\x'));
    const q2 = searchByCelexQuery('3"2016', "POL");
    assert.ok(q2.includes('3\\"2016'));
});

test("search_by_celex pobiera opcjonalne ECLI", () => {
    const q = searchByCelexQuery("62018CJ0311", "ENG");
    assert.ok(q.includes("cdm:case-law_ecli ?ecli"));
});

// --- parsowanie Cellar (fixture: Schrems II po ECLI) -----------------------

test("buildCitations: Schrems II fixture -> CELEX + ECLI + data + typ", () => {
    const data = fixture("cellar_ecli_schrems2.json");
    const rows = data.results.bindings;
    assert.ok(rows.length >= 1);
    const cits = buildCitations(rows, "ENG");
    assert.ok(cits.length >= 1);
    const c = cits[0];
    assert.equal(c.celex, "62018CJ0311");
    assert.equal(c.ecli, "ECLI:EU:C:2020:559");
    assert.equal(c.publication_date, "2020-07-16");
    assert.equal(c.document_type, "JUDG");
    assert.ok(c.title.includes("Schrems"));
    assert.ok(c.url.includes("CELEX%3A62018CJ0311") || c.url.includes("CELEX:62018CJ0311"));
    assert.ok(c.url.includes("/legal-content/PL/TXT/"));
});

test("formatRows: ECLI widoczne w tekscie dla czlowieka", () => {
    const data = fixture("cellar_ecli_schrems2.json");
    const text = formatRows(data.results.bindings, "naglowek:");
    assert.ok(text.includes("ECLI : ECLI:EU:C:2020:559"));
    assert.ok(text.includes("CELEX: 62018CJ0311"));
});

test("uniqueRows: jeden CELEX/ECLI i zachowanie tytułu", () => {
    const rows = [
        { celex: { type: "literal", value: "62018CJ0311" }, ecli: { type: "literal", value: "ECLI:EU:C:2020:559" } },
        { celex: { type: "literal", value: "62018CJ0311" }, ecli: { type: "literal", value: "ECLI:EU:C:2020:559" }, title: { type: "literal", value: "Wyrok TSUE" } },
    ];
    assert.equal(uniqueRows(rows).length, 1);
    assert.equal(buildCitations(rows, "ENG")[0].title, "Wyrok TSUE");
});

test("date_range REG: wybrany typ musi odpowiadać ?type", () => {
    const query = searchByDateRangeQuery("2024-08-01", "2024-08-07", RESOURCE_TYPES.REG, "POL", 2);
    assert.ok(query.includes(`FILTER(?type = <${RESOURCE_TYPES.REG}>)`));
});

// --- parsowanie GDPRhub (fixture: search Schrems) --------------------------

test("buildGdprhubCitations: title + url + snippet + licencja NC", () => {
    const data = fixture("gdprhub_search_schrems.json");
    const { citations, totalHits } = buildGdprhubCitations(data);
    assert.ok(citations.length >= 1);
    assert.ok(totalHits >= citations.length);
    for (const c of citations) {
        assert.equal(c.license, GDPRHUB_LICENSE);
        assert.ok(c.url.startsWith("https://gdprhub.eu/index.php?title="));
        assert.ok(!/<[^>]*>/.test(c.snippet ?? "")); // HTML zdjety ze snippetu
    }
});

test("gdprhubPageUrl: spacje -> podkreslenia, URL-encoding", () => {
    assert.equal(
        gdprhubPageUrl("Article 5 GDPR"),
        "https://gdprhub.eu/index.php?title=Article_5_GDPR",
    );
});

test("formatGdprhubRows: naglowek + total + licencja w tekscie", () => {
    const data = fixture("gdprhub_search_schrems.json");
    const text = formatGdprhubRows(data, "naglowek:");
    assert.ok(text.includes("Trafien lacznie:"));
    assert.ok(text.includes(GDPRHUB_LICENSE));
});

console.log(`\nOK offline - ${passed} testow przeszlo.`);
