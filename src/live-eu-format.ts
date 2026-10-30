// Parsowanie odpowiedzi + budowanie citations i tekstu dla czlowieka.
// Czyste funkcje (bez I/O) - testowane offline w test/offline.mjs.

export interface SparqlBinding {
    [key: string]: { type: string; value: string } | undefined;
}

export interface SparqlResponse {
    head: { vars: string[] };
    results: { bindings: SparqlBinding[] };
}

export interface EuCitation {
    title: string;
    url: string;
    snippet?: string;
    celex?: string;
    ecli?: string;
    publication_date?: string;
    document_type?: string;
    license?: string;
}

export function eurLexUrl(celex: string, lang: string = "PL"): string {
    return `https://eur-lex.europa.eu/legal-content/${lang}/TXT/?uri=CELEX:${encodeURIComponent(celex)}`;
}

export function shortTypeFromUri(uri: string): string {
    // URI: http://publications.europa.eu/resource/authority/resource-type/REG
    const m = uri.match(/\/resource-type\/([A-Z_]+)$/);
    return m ? m[1] : uri;
}

/** Duplikaty Cellar: ten sam CELEX/ECLI może mieć kilka ekspresji/tytułów. */
export function uniqueRows(rows: SparqlBinding[]): SparqlBinding[] {
    const chosen = new Map<string, SparqlBinding>();
    for (const row of rows) {
        const celex = row.celex?.value;
        if (!celex) continue;
        const key = celex + "|" + (row.ecli?.value ?? "");
        const prior = chosen.get(key);
        if (!prior || (!prior.title?.value && row.title?.value)) chosen.set(key, row);
    }
    return [...chosen.values()];
}

export function buildCitations(
    rows: SparqlBinding[],
    _lang: string = "POL", // parametr wewnętrzny dla zachowania zgodności testów
): EuCitation[] {
    const out: EuCitation[] = [];
    for (const row of uniqueRows(rows)) {
        const celex = row.celex?.value;
        if (!celex) continue;
        const title = row.title?.value;
        const date = row.date?.value;
        const typeUri = row.type?.value;
        const ecli = row.ecli?.value;
        out.push({
            title: title ?? celex,
            url: eurLexUrl(celex, "PL"),
            ...(date && { publication_date: date }),
            ...(celex && { celex }),
            ...(ecli && { ecli }),
            ...(typeUri && { document_type: shortTypeFromUri(typeUri) }),
        });
    }
    return out;
}

export function formatRows(rows: SparqlBinding[], header: string): string {
    if (rows.length === 0) {
        return (
            header +
            "\n\nBrak wynikow. Sprobuj szerszego zakresu dat lub innego CELEX-a."
        );
    }
    const lines = [header, ""];
    for (const row of uniqueRows(rows)) {
        const celex = row.celex?.value ?? "brak_celex";
        const date = row.date?.value ?? "?";
        const typeUri = row.type?.value;
        const type = typeUri ? shortTypeFromUri(typeUri) : "?";
        const title = row.title?.value;
        const ecli = row.ecli?.value;
        lines.push(`CELEX: ${celex}`);
        lines.push(`  Data : ${date} | Typ: ${type}`);
        if (ecli) lines.push(`  ECLI : ${ecli}`);
        if (title) lines.push(`  Tytul: ${title}`);
        lines.push(`  URL  : ${eurLexUrl(celex)}`);
        lines.push("");
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GDPRhub (MediaWiki API) - agregator decyzji krajowych organow ochrony danych.
// Tresc na licencji CC BY-NC-SA 4.0 - kazda citation niesie pole license.
// ---------------------------------------------------------------------------

export const GDPRHUB_LICENSE = "CC BY-NC-SA 4.0";

export interface GdprhubSearchResult {
    ns: number;
    title: string;
    pageid: number;
    snippet: string;
    timestamp?: string;
}

export interface GdprhubSearchResponse {
    query?: {
        searchinfo?: { totalhits?: number };
        search?: GdprhubSearchResult[];
    };
}

export function gdprhubPageUrl(title: string): string {
    return `https://gdprhub.eu/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

export function stripHtml(s: string): string {
    return s.replace(/<[^>]*>/g, "");
}

export function buildGdprhubCitations(
    data: GdprhubSearchResponse,
): { citations: EuCitation[]; totalHits: number } {
    const results = data.query?.search ?? [];
    const totalHits = data.query?.searchinfo?.totalhits ?? results.length;
    const citations: EuCitation[] = results.map((r) => ({
        title: r.title,
        url: gdprhubPageUrl(r.title),
        snippet: stripHtml(r.snippet),
        license: GDPRHUB_LICENSE,
    }));
    return { citations, totalHits };
}

export function formatGdprhubRows(
    data: GdprhubSearchResponse,
    header: string,
): string {
    const results = data.query?.search ?? [];
    if (results.length === 0) {
        return header + "\n\nBrak wynikow. Sprobuj innego zapytania.";
    }
    const totalHits = data.query?.searchinfo?.totalhits;
    const lines = [header];
    if (typeof totalHits === "number") {
        lines.push(`Trafien lacznie: ${totalHits}`);
    }
    lines.push("");
    for (const r of results) {
        lines.push(`Tytul  : ${r.title}`);
        lines.push(`  Snippet: ${stripHtml(r.snippet)}`);
        lines.push(`  URL    : ${gdprhubPageUrl(r.title)}`);
        lines.push(`  Licencja tresci: ${GDPRHUB_LICENSE}`);
        lines.push("");
    }
    return lines.join("\n");
}
