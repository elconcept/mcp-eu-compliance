// SPARQL query builders - Publications Office Cellar (ontologia CDM).
// Czyste funkcje (bez I/O) - testowane offline w test/offline.mjs.

export const PREFIXES = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX dc:  <http://purl.org/dc/elements/1.1/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
`;

// Mapowanie typu aktu (skrot uzytkownika) -> URI Resource-Type.
// UWAGA feature-002: postanowienia CJEU maja w Cellar typ .../ORDER (8 362 works),
// NIE .../ORDER_CJ (0 works) - stary URI byl cichym no-opem (zero wynikow, zero bledu).
export const RESOURCE_TYPES: Record<string, string> = {
    REG: "http://publications.europa.eu/resource/authority/resource-type/REG",
    DIR: "http://publications.europa.eu/resource/authority/resource-type/DIR",
    DEC: "http://publications.europa.eu/resource/authority/resource-type/DEC",
    RECO: "http://publications.europa.eu/resource/authority/resource-type/RECO",
    OPIN: "http://publications.europa.eu/resource/authority/resource-type/OPIN",
    JUDG: "http://publications.europa.eu/resource/authority/resource-type/JUDG",
    ORDER: "http://publications.europa.eu/resource/authority/resource-type/ORDER",
    OPIN_AG:
        "http://publications.europa.eu/resource/authority/resource-type/OPIN_AG",
};

// Typy case-law CJEU dostepne w search_cjeu (wyrok / postanowienie / opinia AG).
export const CJEU_TYPES = ["JUDG", "ORDER", "OPIN_AG"] as const;

export function sparqlEscape(value: string): string {
    // Eskapuj cudzyslowy w SPARQL - tylko " i \ wymagaja escape'u.
    return value.replace(/["\\]/g, "\\$&");
}

export function searchByCelexQuery(celex: string, lang: string): string {
    const safeCelex = sparqlEscape(celex);
    const safeLang = sparqlEscape(lang);
    return `${PREFIXES}
SELECT DISTINCT ?work ?celex ?ecli ?date ?type ?title
WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  FILTER(STR(?celex) = "${safeCelex}")
  OPTIONAL { ?work cdm:case-law_ecli ?ecli }
  OPTIONAL { ?work cdm:work_date_document ?date }
  OPTIONAL { ?work cdm:work_has_resource-type ?type }
  OPTIONAL {
    ?expr cdm:expression_belongs_to_work ?work ;
          cdm:expression_uses_language ?lang ;
          cdm:expression_title ?title .
    ?lang dc:identifier "${safeLang}" .
  }
}
LIMIT 1
`;
}

export function searchByDateRangeQuery(
    dateFrom: string,
    dateTo: string,
    typeUri: string | null,
    lang: string,
    limit: number,
): string {
    const safeFrom = sparqlEscape(dateFrom);
    const safeTo = sparqlEscape(dateTo);
    const safeLang = sparqlEscape(lang);
    // Dla wielu typów jednego work wybierz dokładnie żądany ?type.
    const typeFilter = typeUri
        ? `?work cdm:work_has_resource-type ?type .
  FILTER(?type = <${typeUri}>)`
        : "OPTIONAL { ?work cdm:work_has_resource-type ?type }";
    return `${PREFIXES}
SELECT DISTINCT ?work ?celex ?date ?type ?title
WHERE {
  ${typeFilter}
  ?work cdm:work_date_document ?date .
  OPTIONAL { ?work cdm:resource_legal_id_celex ?celex }
  OPTIONAL {
    ?expr cdm:expression_belongs_to_work ?work ;
          cdm:expression_uses_language ?lang ;
          cdm:expression_title ?title .
    ?lang dc:identifier "${safeLang}" .
  }
  FILTER (?date >= "${safeFrom}"^^xsd:date && ?date <= "${safeTo}"^^xsd:date)
  FILTER NOT EXISTS { ?work cdm:do_not_index "true"^^xsd:boolean }
}
ORDER BY DESC(?date)
LIMIT ${limit}
`;
}

export function searchCjeuQuery(
    dateFrom: string | null,
    dateTo: string | null,
    documentType: string | null,
    keyword: string | null,
    lang: string,
    limit: number,
): string {
    const safeLang = sparqlEscape(lang);
    const dateFilter =
        dateFrom && dateTo
            ? `FILTER (?date >= "${sparqlEscape(dateFrom)}"^^xsd:date && ?date <= "${sparqlEscape(dateTo)}"^^xsd:date)`
            : "";
    // Bez document_type: wszystkie 3 typy case-law (JUDG + ORDER + OPIN_AG).
    const typeUris = (documentType ? [documentType] : [...CJEU_TYPES])
        .map((t) => `<${RESOURCE_TYPES[t]}>`)
        .join(", ");
    // Keyword przeszukuje tytul ekspresji (tytul CJEU zawiera strony, sygnature
    // sprawy i slowa kluczowe wyroku) - tytul przestaje byc OPTIONAL.
    const titleBlock = keyword
        ? `?expr cdm:expression_belongs_to_work ?work ;
        cdm:expression_uses_language ?lang ;
        cdm:expression_title ?title .
  ?lang dc:identifier "${safeLang}" .
  FILTER(CONTAINS(LCASE(STR(?title)), "${sparqlEscape(keyword.toLowerCase())}"))`
        : `OPTIONAL {
    ?expr cdm:expression_belongs_to_work ?work ;
          cdm:expression_uses_language ?lang ;
          cdm:expression_title ?title .
    ?lang dc:identifier "${safeLang}" .
  }`;
    return `${PREFIXES}
SELECT DISTINCT ?work ?celex ?ecli ?date ?type ?title
WHERE {
  ?work cdm:work_has_resource-type ?type .
  FILTER(?type IN (${typeUris}))
  ?work cdm:work_date_document ?date .
  OPTIONAL { ?work cdm:resource_legal_id_celex ?celex }
  OPTIONAL { ?work cdm:case-law_ecli ?ecli }
  ${titleBlock}
  ${dateFilter}
  FILTER NOT EXISTS { ?work cdm:do_not_index "true"^^xsd:boolean }
}
ORDER BY DESC(?date)
LIMIT ${limit}
`;
}

export function searchCjeuByEcliQuery(ecli: string, lang: string): string {
    // ECLI w Cellar to literal typu xsd:string - rowanie przez STR(),
    // golym literalem "..." nie zmatchuje (zweryfikowane live 2026-07-08).
    const safeEcli = sparqlEscape(ecli);
    const safeLang = sparqlEscape(lang);
    const typeUris = CJEU_TYPES.map((t) => `<${RESOURCE_TYPES[t]}>`).join(", ");
    return `${PREFIXES}
SELECT DISTINCT ?work ?celex ?ecli ?date ?type ?title
WHERE {
  ?work cdm:case-law_ecli ?ecli .
  FILTER(STR(?ecli) = "${safeEcli}")
  ?work cdm:work_has_resource-type ?type .
  FILTER(?type IN (${typeUris}))
  OPTIONAL { ?work cdm:resource_legal_id_celex ?celex }
  OPTIONAL { ?work cdm:work_date_document ?date }
  OPTIONAL {
    ?expr cdm:expression_belongs_to_work ?work ;
          cdm:expression_uses_language ?lang ;
          cdm:expression_title ?title .
    ?lang dc:identifier "${safeLang}" .
  }
}
LIMIT 5
`;
}
