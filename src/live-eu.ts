// Jedna usługa MCP UE — moduł LIVE przeniesiony z elconcept/mcp-eu-sparql
// Zawiera wyłącznie obsługę 5 narzędzi Cellar / GDPRhub; nie uruchamia osobnego serwera.
// Upstream: https://github.com/elconcept/mcp-eu-sparql (MIT).
import { RESOURCE_TYPES, searchByCelexQuery, searchByDateRangeQuery,
  searchCjeuByEcliQuery, searchCjeuQuery } from "./live-eu-queries.js";
import { buildCitations, buildGdprhubCitations, formatGdprhubRows, formatRows,
  type GdprhubSearchResponse, type SparqlResponse } from "./live-eu-format.js";

const SPARQL_ENDPOINT = "https://publications.europa.eu/webapi/rdf/sparql";
const GDPRHUB_API = "https://gdprhub.eu/api.php";
const HTTP_TIMEOUT_MS = 30000;

async function runSparql(query: string): Promise<SparqlResponse> {
    const params = new URLSearchParams();
    params.set("query", query);
    params.set("format", "application/sparql-results+json");
    params.set("timeout", String(HTTP_TIMEOUT_MS));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS + 5000);
    try {
        const res = await fetch(SPARQL_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/sparql-results+json",
            },
            body: params.toString(),
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(
                `SPARQL endpoint returned HTTP ${res.status} ${res.statusText}`,
            );
        }
        return (await res.json()) as SparqlResponse;
    } finally {
        clearTimeout(timer);
    }
}

async function runGdprhubSearch(
    query: string,
    limit: number,
): Promise<GdprhubSearchResponse> {
    const params = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: query,
        srlimit: String(limit),
        format: "json",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS + 5000);
    try {
        const res = await fetch(`${GDPRHUB_API}?${params.toString()}`, {
            headers: {
                Accept: "application/json",
                "User-Agent":
                    "mcp-eu-sparql (https://github.com/matematicsolutions/mcp-eu-sparql)",
            },
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(
                `GDPRhub API returned HTTP ${res.status} ${res.statusText}`,
            );
        }
        return (await res.json()) as GdprhubSearchResponse;
    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Instructions (procedural orchestration) - wstrzykiwane przez Server.
// Drift test (test/drift.mjs) sprawdza spojnosc z TOOLS i ErrorCode.
// Pattern z dograh-hq/dograh v1.31.0 (BSD-2) via mcp-eu-compliance v0.2.0.
// ---------------------------------------------------------------------------

export const LIVE_INSTRUCTIONS = `Ten serwer MCP odpytuje oficjalny endpoint SPARQL Publications Office (publications.europa.eu/webapi/rdf/sparql) i graf wiedzy Cellar (ontologia CDM) oraz API MediaWiki GDPRhub (gdprhub.eu). Zwraca akty prawne UE, orzeczenia CJEU (z CELEX i ECLI) oraz decyzje krajowych organow ochrony danych.

## Kolejnosc wywolan

### Konkretny akt prawny lub orzeczenie
1. \`search_by_celex\` - jesli znasz CELEX (np. RODO=32016R0679, AI Act=32024R1689, DORA=32022R2554, wyrok Schrems II=62018CJ0311). Najszybciej i najpewniej.
2. \`search_cjeu_by_ecli\` - jesli znasz ECLI orzeczenia CJEU (np. ECLI:EU:C:2020:559 = Schrems II). Zwraca CELEX, date, tytul (strony + sygnatura + slowa kluczowe).

### Przeglad legislacji w okresie
3. \`search_by_date_range\` - akty UE z zakresu dat. Opcjonalnie filtruj typ (REG/DIR/DEC/RECO/OPIN). Maks 50 wynikow.

### Orzecznictwo CJEU
4. \`search_cjeu\` - orzeczenia Trybunalu Sprawiedliwosci UE: wyroki (JUDG, 34 tys.), postanowienia (ORDER, 8 tys.), opinie rzecznikow generalnych (OPIN_AG, 14 tys.). Opcjonalny zakres dat, typ dokumentu i \`query\` (keyword w tytule - tytul CJEU zawiera strony, sygnature i slowa kluczowe wyroku). Format CELEX dla CJEU: 6 + rok + kod (CJ=wyrok C, CO=postanowienie, CC=opinia AG) + nr sprawy (np. 62018CJ0311).

### Decyzje krajowych DPA (RODO w praktyce panstw czlonkowskich)
5. \`search_gdprhub\` - pelnotekstowe wyszukiwanie w GDPRhub (gdprhub.eu, projekt noyb) - decyzje krajowych organow ochrony danych z calej UE + komentarze do artykulow RODO. UWAGA licencja tresci: CC BY-NC-SA 4.0 (niekomercyjna, share-alike) - kazda citation niesie pole \`license\` - przy wykorzystaniu tresci (nie samego linku) uprzedz uzytkownika o ograniczeniu NC.

## Twarde ograniczenia

- **CELEX/ECLI kluczowe dla cytowalnosci** - odpowiedzi Cellar zawieraja CELEX (i ECLI dla case-law) w \`structuredContent.citations\`. Bez identyfikatora brak cytowalnosci.
- **Wyłącznie język polski** – bez selektora języka. Pobieraj polskie tytuły przez Cellar (POL) i linkuj do polskiej wersji EUR-Lex (PL). Przy braku tytułu PL wskaż brak, bez cichego fallbacku EN.
- **Stateless** - kazde wywolanie idzie do zrodla live. NIE cachuj wynikow (akty konsoliduja sie / status sie zmienia).
- **Bez scrapingu** - Cellar przez oficjalny SPARQL endpoint, GDPRhub przez oficjalne API MediaWiki.
- **\`structuredContent.citations\`**: title, url, celex?, ecli?, publication_date?, document_type?, snippet?, license?. Cytuj te citations w odpowiedzi koncowej.

## Iteracja po bledach

Tool zwraca \`isError: true\` + tekst z prefixem \`[code]\`. Typowe kody:
- \`missing_arg\` - brakujacy wymagany parametr (celex w search_by_celex; ecli w search_cjeu_by_ecli; query w search_gdprhub; date_from/date_to w search_by_date_range). Przeczytaj inputSchema.
- \`invalid_date\` - data nie w formacie YYYY-MM-DD lub date_to przed date_from.
- \`upstream_error\` - blad endpointu (HTTP, timeout, malformed response). Retry raz przed surface do uzytkownika.
- \`empty_result\` - brak wynikow dla danego CELEX/ECLI/zakresu. Zwery zewnetrznym katalogiem (eur-lex.europa.eu / curia.europa.eu / gdprhub.eu).

## Styl odpowiedzi

- Cytuj akty w formacie "AI Act (32024R1689)" lub "RODO (32016R0679)" - skrocony tytul + CELEX.
- Dla CJEU: "Wyrok C-311/18 Schrems II (62018CJ0311, ECLI:EU:C:2020:559) z dnia 16.07.2020".
- Dla GDPRhub: tytul strony + URL + adnotacja o licencji CC BY-NC-SA 4.0.
- NIE wymyslaj CELEX-ow, ECLI ani dat - wszystko z \`structuredContent.citations\`.
- Brak urzędowej wersji PL trzeba wyraźnie oznaczyć; nie przedstawiaj tłumaczenia jako tekstu urzędowego.`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    idempotentHint: true,
    destructiveHint: false,
    openWorldHint: true, // upstream endpoints live
} as const;

export const LIVE_TOOLS = [
    {
        name: "search_by_celex",
        annotations: READ_ONLY_ANNOTATIONS,
        description:
            "Znajdz akt prawny UE lub orzeczenie CJEU po numerze CELEX. " +
            "Numer CELEX jest unikalny i identyfikuje dokument niezaleznie od jezyka. " +
            "Przyklady: 32016R0679 (RODO), 31995L0046 (uchylona dyrektywa o ochronie danych), " +
            "62018CJ0311 (wyrok Schrems II). Zwraca polski tytuł (jeśli dostępny), ECLI (dla orzeczeń) i polski adres EUR-Lex.",
        inputSchema: {
            type: "object",
            properties: {
                celex: {
                    type: "string",
                    description: "Numer CELEX, np. '32016R0679' (RODO).",
                },
            },
            required: ["celex"],
        },
    },
    {
        name: "search_by_date_range",
        annotations: READ_ONLY_ANNOTATIONS,
        description:
            "Znajdz akty prawne UE z zakresu dat (po dacie dokumentu). " +
            "Opcjonalnie filtruj po typie (REG=rozporzadzenie, DIR=dyrektywa, " +
            "DEC=decyzja, RECO=zalecenie, OPIN=opinia). Maks. 50 wynikow na zapytanie. " +
            "Uzyteczne do przegladu aktow z konkretnego okresu legislacyjnego.",
        inputSchema: {
            type: "object",
            properties: {
                date_from: {
                    type: "string",
                    description: "Data od (YYYY-MM-DD).",
                },
                date_to: {
                    type: "string",
                    description: "Data do (YYYY-MM-DD).",
                },
                document_type: {
                    type: "string",
                    description:
                        "Skrot typu aktu: REG, DIR, DEC, RECO, OPIN. Pomin zeby objac wszystkie.",
                    enum: ["REG", "DIR", "DEC", "RECO", "OPIN"],
                },
                limit: {
                    type: "number",
                    description:
                        "Maks. liczba wynikow (1-50). Domyslnie 20.",
                    minimum: 1,
                    maximum: 50,
                },
            },
            required: ["date_from", "date_to"],
        },
    },
    {
        name: "search_cjeu",
        annotations: READ_ONLY_ANNOTATIONS,
        description:
            "Wyszukaj orzecznictwo Trybunalu Sprawiedliwosci UE (CJEU): wyroki (JUDG), " +
            "postanowienia (ORDER) i opinie rzecznikow generalnych (OPIN_AG). " +
            "Opcjonalnie zawez do zakresu dat, typu dokumentu i keyworda w tytule " +
            "(tytul CJEU zawiera strony sprawy, sygnature i slowa kluczowe wyroku). " +
            "Zwraca CELEX (np. 62018CJ0311), ECLI, datę wydania, polski tytuł (jeśli dostępny) i adres EUR-Lex PL.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "Keyword wyszukiwany w tytule orzeczenia (case-insensitive), np. 'personal data' albo 'Schrems'. Opcjonalny.",
                },
                date_from: {
                    type: "string",
                    description: "Data od (YYYY-MM-DD). Opcjonalna.",
                },
                date_to: {
                    type: "string",
                    description: "Data do (YYYY-MM-DD). Opcjonalna.",
                },
                document_type: {
                    type: "string",
                    description:
                        "Typ dokumentu: JUDG=wyrok, ORDER=postanowienie, OPIN_AG=opinia rzecznika generalnego. Pomin zeby objac wszystkie trzy.",
                    enum: ["JUDG", "ORDER", "OPIN_AG"],
                },
                limit: {
                    type: "number",
                    description:
                        "Maks. liczba wynikow (1-50). Domyslnie 20.",
                    minimum: 1,
                    maximum: 50,
                },
            },
            required: [],
        },
    },
    {
        name: "search_cjeu_by_ecli",
        annotations: READ_ONLY_ANNOTATIONS,
        description:
            "Znajdz orzeczenie CJEU po identyfikatorze ECLI (European Case Law Identifier), " +
            "np. 'ECLI:EU:C:2020:559' (Schrems II). Zwraca CELEX, date wydania, tytul " +
            "(strony + sygnatura + slowa kluczowe) i EUR-Lex URL.",
        inputSchema: {
            type: "object",
            properties: {
                ecli: {
                    type: "string",
                    description:
                        "Identyfikator ECLI orzeczenia CJEU, np. 'ECLI:EU:C:2020:559'.",
                },
            },
            required: ["ecli"],
        },
    },
    {
        name: "search_gdprhub",
        annotations: READ_ONLY_ANNOTATIONS,
        description:
            "Pelnotekstowe wyszukiwanie w GDPRhub (gdprhub.eu) - wiki projektu noyb " +
            "agregujaca decyzje krajowych organow ochrony danych (DPA) z calej UE " +
            "oraz komentarze do artykulow RODO. Zwraca tytul, snippet i URL strony. " +
            "Licencja tresci: CC BY-NC-SA 4.0 (pole license w kazdej citation).",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "Zapytanie pelnotekstowe, np. 'Schrems', 'UODO fine', 'Article 33 notification'.",
                },
                limit: {
                    type: "number",
                    description: "Maks. liczba wynikow (1-50). Domyslnie 10.",
                    minimum: 1,
                    maximum: 50,
                },
            },
            required: ["query"],
        },
    },
] as const;

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

// Strukturalne kody bledow - drift test asercja.
type ErrorCode = "missing_arg" | "invalid_date" | "upstream_error" | "empty_result";

function errorResult(text: string, code: ErrorCode) {
    return {
        content: [{ type: "text" as const, text: `[${code}] ${text}` }],
        structuredContent: { error_code: code },
        isError: true,
    };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;



export type LiveToolResult = {
    content: { type: "text"; text: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
};

/** Jeden dispatcher dla 5 narzędzi live; źródło offline wywoływane osobno. */
export async function callLiveTool(name: string, a: Record<string, unknown>): Promise<LiveToolResult> {
    // Ignoruj przestarzały a.lang; wynik zawsze po polsku, Cellar z POL.
    const lang = "POL";
    try {
        switch (name) {
            case "search_by_celex": {
                if (!a.celex || typeof a.celex !== "string") {
                    return errorResult("parametr 'celex' jest wymagany (string).", "missing_arg");
                }
                const sparql = searchByCelexQuery(a.celex, lang);
                const data = await runSparql(sparql);
                const rows = data.results.bindings;
                const text = formatRows(
                    rows,
                    `Wynik wyszukiwania CELEX "${a.celex}":`,
                );
                return {
                    content: [{ type: "text", text }],
                    structuredContent: {
                        citations: buildCitations(rows, lang),
                    },
                };
            }

            case "search_by_date_range": {
                const dateFrom = a.date_from;
                const dateTo = a.date_to;
                if (typeof dateFrom !== "string" || typeof dateTo !== "string") {
                    return errorResult(
                        "'date_from' i 'date_to' sa wymagane (format YYYY-MM-DD).",
                        "missing_arg",
                    );
                }
                if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
                    return errorResult(
                        `daty musza byc w formacie YYYY-MM-DD. Otrzymano: from='${dateFrom}', to='${dateTo}'.`,
                        "invalid_date",
                    );
                }
                if (dateTo < dateFrom) {
                    return errorResult(
                        `date_to ('${dateTo}') wczesniejsza niz date_from ('${dateFrom}').`,
                        "invalid_date",
                    );
                }
                const typeShort =
                    typeof a.document_type === "string" ? a.document_type : null;
                const typeUri = typeShort
                    ? (RESOURCE_TYPES[typeShort] ?? null)
                    : null;
                const limit =
                    typeof a.limit === "number"
                        ? Math.min(50, Math.max(1, Math.floor(a.limit)))
                        : 20;
                const sparql = searchByDateRangeQuery(
                    dateFrom,
                    dateTo,
                    typeUri,
                    lang,
                    limit,
                );
                const data = await runSparql(sparql);
                const rows = data.results.bindings;
                const text = formatRows(
                    rows,
                    `Wynik wyszukiwania aktów (${dateFrom}–${dateTo}, typ=${typeShort ?? "wszystkie"}):`,
                );
                return {
                    content: [{ type: "text", text }],
                    structuredContent: {
                        citations: buildCitations(rows, lang),
                    },
                };
            }

            case "search_cjeu": {
                const dateFrom =
                    typeof a.date_from === "string" ? a.date_from : null;
                const dateTo =
                    typeof a.date_to === "string" ? a.date_to : null;
                if (
                    (dateFrom && !DATE_RE.test(dateFrom)) ||
                    (dateTo && !DATE_RE.test(dateTo))
                ) {
                    return errorResult(
                        `daty musza byc w formacie YYYY-MM-DD. Otrzymano: from='${dateFrom}', to='${dateTo}'.`,
                        "invalid_date",
                    );
                }
                if (dateFrom && dateTo && dateTo < dateFrom) {
                    return errorResult(
                        `date_to ('${dateTo}') wczesniejsza niz date_from ('${dateFrom}').`,
                        "invalid_date",
                    );
                }
                const docType =
                    typeof a.document_type === "string" &&
                    ["JUDG", "ORDER", "OPIN_AG"].includes(a.document_type)
                        ? a.document_type
                        : null;
                const keyword =
                    typeof a.query === "string" && a.query.trim().length > 0
                        ? a.query.trim()
                        : null;
                const limit =
                    typeof a.limit === "number"
                        ? Math.min(50, Math.max(1, Math.floor(a.limit)))
                        : 20;
                const sparql = searchCjeuQuery(
                    dateFrom,
                    dateTo,
                    docType,
                    keyword,
                    lang,
                    limit,
                );
                const data = await runSparql(sparql);
                const rows = data.results.bindings;
                const text = formatRows(
                    rows,
                    `Wynik wyszukiwania TSUE (${dateFrom ?? "*"}–${dateTo ?? "*"}, typ=${docType ?? "wszystkie"}, fraza=${keyword ?? "-"}):`,
                );
                return {
                    content: [{ type: "text", text }],
                    structuredContent: {
                        citations: buildCitations(rows, lang),
                    },
                };
            }

            case "search_cjeu_by_ecli": {
                if (!a.ecli || typeof a.ecli !== "string") {
                    return errorResult(
                        "parametr 'ecli' jest wymagany (string), np. 'ECLI:EU:C:2020:559'.",
                        "missing_arg",
                    );
                }
                const sparql = searchCjeuByEcliQuery(a.ecli, lang);
                const data = await runSparql(sparql);
                const rows = data.results.bindings;
                if (rows.length === 0) {
                    return errorResult(
                        `brak orzeczenia CJEU o ECLI '${a.ecli}'. Sprawdz format (ECLI:EU:C:YYYY:NNN) lub zweryfikuj na curia.europa.eu.`,
                        "empty_result",
                    );
                }
                const text = formatRows(
                    rows,
                    `Wynik wyszukiwania ECLI "${a.ecli}":`,
                );
                return {
                    content: [{ type: "text", text }],
                    structuredContent: {
                        citations: buildCitations(rows, lang),
                    },
                };
            }

            case "search_gdprhub": {
                if (!a.query || typeof a.query !== "string") {
                    return errorResult(
                        "parametr 'query' jest wymagany (string).",
                        "missing_arg",
                    );
                }
                const limit =
                    typeof a.limit === "number"
                        ? Math.min(50, Math.max(1, Math.floor(a.limit)))
                        : 10;
                const data = await runGdprhubSearch(a.query, limit);
                const { citations } = buildGdprhubCitations(data);
                const text = formatGdprhubRows(
                    data,
                    `Wynik search_gdprhub(query="${a.query}", limit=${limit}):`,
                );
                return {
                    content: [{ type: "text", text }],
                    structuredContent: { citations },
                };
            }

            default:
                return errorResult(`Nieznane narzedzie: ${name}`, "missing_arg");
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(
            `Blad komunikacji ze zrodlem upstream: ${msg}. Sprobuj ponownie za chwile lub zawez zakres dat / dodaj typ dokumentu.`,
            "upstream_error",
        );
    }
}
