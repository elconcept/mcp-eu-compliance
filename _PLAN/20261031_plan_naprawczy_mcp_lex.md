# EU-COMPLIANCE — plan odzyskania pełnych treści i polskiego korpusu

> Audyt: 2026-10-31. Źródła: test wszystkich narzędzi przez portal lex.xlap.pl/mcp, testy bezpośrednich kontenerów przez Portainer/Synology, kontrola kodu repozytoriów elconcept. To **plan**, nie potwierdzenie wdrożenia naprawy. Oznaczenia: **POTWIERDZONE** = zaobserwowany wynik i/lub wskazana przyczyna w kodzie; **DO SPRAWDZENIA** = hipoteza. 

## Reguły wspólne
- Publiczny interfejs narzędzi, zapytania w języku naturalnym, metadane prezentacyjne, fragmenty i błędy: **tylko po polsku**. Bez widocznego selektora języka. Identyfikatory techniczne, oryginalne sygnatury i adresy źródłowe pozostają niezmienione. W okresie migracji stary parametr `lang` można akceptować dla zgodności, ignorować i stosować PL; potem usunąć z publicznego schematu.
- Wyniki prawne nie mogą być dopowiadane. Rozróżniać tekst urzędowy (ze wskazaniem języka i źródła) od komentarza/nieurzędowego przekładu; przy braku wiarygodnej polskiej wersji raportować brak, nie zastępować angielskim tekstem ani nie udawać polskiej wersji urzędowej.
- MCP `content` (dane merytoryczne) **i** `structuredContent` (metadane) zachować równolegle. Testować bezpośrednio oraz przez Cloudflare i portal `lex`; nie uznawać samej listy `citations` za sukces funkcjonalny.
- Diagnostyka i testy przed zmianą produkcyjną; PR → testy offline → smoke staging → porównanie surowych odpowiedzi → kontrolowany rollout → monitoring/rollback. Nigdy nie publikować haseł, tokenów, PII ani pełnych logów uwierzytelnienia.

## Materiał dowodowy
- **POTWIERDZONE:** `/app/data/regulations.db` istnieje w kontenerze, rozmiar 53 637 120 B, SHA-256 `64e74af9e8f27cbe829bd61682ca739eec17ca10237ef526179277cc119bf1e4` zgodny z `Dockerfile.nas`; 5 132 wiersze `provisions`, 5 132 `content_fts`, 407 `evidence_requirements`. Hipoteza „korpus nie został pobrany” jest wykluczona dla badanego obrazu.
- **POTWIERDZONE:** `eu_search('breach notification')` zwraca GDPR 33 i LED 30; polskie `ochrona danych osobowych` nie dało trafień. Korpus zawiera angielskie brzmienie art. 33 RODO; sama angielska baza nie spełnia wymagania PL.
- **POTWIERDZONE:** bezpośrednie stdio, lokalny `/mcp` i publiczny `https://eu-compliance.xlap.pl/mcp` zwracają art. 33 z polem `content` (~2162 znaków) i `citations`; klient przez portal `lex` widzi tylko `citations`. Cloudflare transport nie ucinał badanego wyniku.
- **POTWIERDZONE:** `docker-compose.yaml` w komentarzu wskazuje nieaktualną nazwę `mcp-eu-compliance.xlap.pl`; aktywny DNS/weryfikowany endpoint to `eu-compliance.xlap.pl`.
- **DO SPRAWDZENIA:** gdzie dokładnie adapter po portalu usuwa `content`; czy rekordy wszystkich 14 regulacji mają oficjalne polskie odpowiedniki; czy wersje i nowelizacje są aktualne.

## Plan
1. **P0 — zachowanie treści MCP:** weryfikacja serializacji `tools/call` przez portal `lex` i klienta; compare-bytes na tym samym żądaniu `eu_article(GDPR,33)` na czterech warstwach. Zwracać `content` i `structuredContent`, bez duplikowania artykułów w `citations`.
2. **P0 — audyt źródła tłumaczeń:** tabela 14 regulacji: CELEX, wydanie, wersja skonsolidowana, urzędowa treść PL w EUR-Lex, liczba artykułów PL vs EN, brakujące jednostki i status aktualności; każda pozycja ze źródłem i checksumem. Nie tłumaczyć prawnie wiążącego tekstu wyłącznie modelem.
3. **P1 — indeks PL:** pobrać urzędową polską wersję aktów, zachować oryginalne CELEX/artykuł/akapit, zbudować `content_fts_pl` ze stemmingiem/normalizacją polskich odmian; zapytanie polskie wyszukuje polską treść. Odpowiedzi `eu_search`, `eu_article`, `eu_compare`, `eu_check_applicability`, `eu_evidence` wyłącznie PL. Brak PL → jawny kod `pl_text_unavailable`, nie ukryty angielski fallback.
4. **P1 — trafność:** benchmark polskich fraz: „zgłoszenie naruszenia”, „naruszenie ochrony danych”, „odporność cyfrowa”, „incydent ICT”, „podmiot kluczowy”, „system AI wysokiego ryzyka”. Sprawdzić nazwy 14 regulacji, stosowalność, dowody i przypisy.
5. **P2 — publikacja:** aktualizacja `README.md`, `Dockerfile.nas`, skryptów pobierania z kontrolą sumy i drift, komentarza domeny, test snapshot/aktualność; staging/rollback.

## Akceptacja
- Zapytania po polsku zwracają **polskie** trafienia i pełny urzędowy art. 33 RODO, datę wersji, link do EUR-Lex PL, poprawne CELEX; wszystkie pięć narzędzi zwraca pełne pole `content` przez `lex`.
- Dla każdego z 14 aktów raport kompletności PL + źródło/wersja; brak ukrytego tłumaczenia lub nieoznakowanego tekstu EN.
- Testy integralności, logi i odpowiedzi nie zawierają tokenów; build powtarzalny i z możliwością rollbacku.

## Pliki / dowody
`src/index.ts` (`handleSearch`, `handleArticle`, `handleCompare`, `handleEvidence`), `Dockerfile.nas`, `scripts/fetch-corpus.mjs`, `docker-compose.yaml`, adapter portalu Cloudflare.
