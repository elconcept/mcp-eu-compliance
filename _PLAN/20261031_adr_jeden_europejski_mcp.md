# ADR — Jeden europejski MCP: EUR-Lex/TSUE/Compliance

Data: 2026-10-31. Status: **wdrażanie na gałęzi `feat/eu-unified-mcp-20261031`; NIE wdrożono na produkcję**.

## Wniosek

Scalić `mcp-eu-sparql` do `mcp-eu-compliance` jako jeden **serwer MCP**, jeden proces i jeden obraz/stack docelowy. Nie scalać źródeł danych w jedną bazę: zachować dwie ścieżki o odmiennych gwarancjach świeżości. Nie dotykać `mcp-repertorium`.

| Ścieżka | Zawartość | Dostępność | Status danych |
|---|---|---|---|
| `offline` | 14 regulacji UE; FTS5, artykuły, porównania, stosowalność i dowody | Gdy Cellar offline | Migawka, data i hash |
| `live` | CELEX, ECLI, TSUE/CJEU, bieżące akty, GDPRhub | Wymaga internetu | Dane na żywo, źródło i czas |
| `portal` | Jedno `tools/list`, 10 narzędzi | Jedna sesja/uwierzytelnienie | Oryginalne `content` i `structuredContent` |

## Dlaczego nie po prostu jedna baza danych?

- Ścieżka offline ma realnie 5 132 przepisy w SQLite i 407 wymagań dowodowych w bazie (plik 53 637 120 B, SHA `64e74af9e8f27cbe829bd61682ca739eec17ca10237ef526179277cc119bf1e4`). To migawka, a nie źródło na żywo; nie obejmuje pełnego orzecznictwa TSUE.
- Ścieżka live pyta urzędowy SPARQL Publications Office, ma CELEX/ECLI i pozwala wykryć nowsze dokumenty, ale nie gwarantuje obecności tekstów artykułów przy braku internetu. GDPRhub jest źródłem pomocniczym z osobną licencją CC BY-NC-SA 4.0.
- Obecny korpus offline zawiera angielskie brzmienie art. 33 RODO. Docelowo **obowiązkowy oficjalny polski tekst i polski FTS** (również przed produkcyjnym zamknięciem starego kontenera). Nie udawać, że kopia EN jest wersją PL. Jeżeli brak wersji PL, zgłosić brak urzędowej wersji, nie stosować po cichu EN.

## Zasady kontraktu

- Publiczne zapytania, tytuły, streszczenia prezentacyjne, błędy i teksty zwracane: **po polsku**; brak selektora `lang`. Wewnętrznie `POL` do Cellar, `PL` w URL EUR-Lex. Dotychczasowe `lang` przyjmować przejściowo i ignorować.
- W pierwszym etapie zachować nazwy dziesięciu istniejących endpointów: `eu_search`, `eu_article`, `eu_compare`, `eu_check_applicability`, `eu_evidence`, `search_by_celex`, `search_by_date_range`, `search_cjeu`, `search_cjeu_by_ecli`, `search_gdprhub`. Nie usunąć żadnej funkcji użytkownikom.
- `content` i `structuredContent` przechodzą nieredukowane przez serwer, transport, Cloudflare i portal lex. Nie zastępować odpowiedzi samą listą citations. Zły parametr → jawny kod błędu; awaria źródła live nie może blokować funkcji offline.
- Każde trafienie ma typ źródła, identyfikator (CELEX/ECLI), datę lub datę migawki i URL; odróżniać tekst urzędowy, materiał pomocniczy i wniosek o stosowalności.

## Plan migracji

1. **Faza A (gałąź, bez wdrażania):** przenieść live `queries` i `format` do oddzielnych modułów; wspólny serwer MCP 10 narzędzi w repo `mcp-eu-compliance`; brak nowych zależności poza obecnymi. Wydanie semver i regeneracja lock schematów.
2. **Faza B:** testy parity wszystkich dziesięciu endpointów i regresji; fixtures RODO `32016R0679`, Schrems II `ECLI:EU:C:2020:559`, DORA/NIS2, GDPRhub; różnica `REG` vs `CORRIGENDUM`, brak duplikatów; awaria Cellar a nadal działający korpus. Test wszystkich trzech transportów.
3. **Faza C:** zbudować oficjalną polską warstwę korpusu 14 regulacji na podstawie EUR-Lex PL (aktualny tekst, daty, checksum, identyczne artykuły) i FTS PL. Dopiero wtedy uznać warunek pełnej polonizacji za spełniony. Sprawdzić licencje/atrybucję i zmianę statusu źródeł.
4. **Faza D (kontrolowane wdrożenie):** nowy jeden stack przy **zachowaniu obu obecnych usług**; smoke i porównanie JSON-RPC przez portal, następnie podmienić dwa źródła w konfiguracji `lex` na jeden, ponownie sparować/odświeżyć narzędzia (bez nowych polityk per serwer); dopiero po monitoringu usunąć osierocony stack SPARQL.
5. **Rollback:** zachować obraz+konfigurację+źródłowe URL dotychczasowych dwóch stacków do czasu przejścia kryteriów odbioru; przy regresji przywrócić poprzedni routing. Brak ingerencji w REPERTORIUM.

## Kryteria odbioru

- `tools/list`: 10 nazw i publiczny brak `lang`; działanie dwóch backendów z jednego transportu/uwierzytelnienia.
- `eu_article(GDPR,33)` zwraca dosłowny **polski** urzędowy tekst, aktualny CELEX+wersję i citations; `search_by_celex(32016R0679)` zwraca polski tytuł i adres EUR-Lex PL.
- `search_cjeu_by_ecli(ECLI:EU:C:2020:559)` zwraca unikalne orzeczenie i ECLI; `search_gdprhub` poprawnie raportuje zero wyników i błąd upstream, zachowując licencję źródła.
- Test treści `content` i `structuredContent` na bezpośrednim stdio, HTTP Cloudflare i `lex` potwierdza identyczność lub jawnie udokumentowane bezstratne stronicowanie.
- Brak ukrytej zmiany źródeł, statusu prawnego i języka; test awarii live nie zakłóca offline. Żaden przypadek nie korzysta automatycznie z nieurzędowego tłumaczenia jako tekstu ustawy.

## Blokery wydania

1. Oficjalny korpus polski i PL FTS dla 14 aktów.
2. Zlokalizowanie redukcji `content` po stronie `lex`/adaptera; bez tego samo złączenie kontenerów nie naprawia brakujących odpowiedzi.
3. Pełne CI, fixture i smoke, bez utraty wyniku któregokolwiek z 10 narzędzi.
4. Zgodność importu/manifestów z licencjami MIT i Apache-2.0 oraz ograniczeniami zawartości GDPRhub.

**Nie mylić PR implementacyjnego z zakończeniem migracji produkcyjnej.**
