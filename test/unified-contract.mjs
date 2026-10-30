#!/usr/bin/env node
// End-to-end test jednego MCP: 10 narzędzi, brak selektora lang, pełny content.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = new Client({ name: "eu-unified-contract", version: "0.5.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "dist/index.js")] });
await client.connect(transport);
try {
  const { tools } = await client.listTools();
  const expected = [
    "eu_search", "eu_article", "eu_compare", "eu_check_applicability", "eu_evidence",
    "search_by_celex", "search_by_date_range", "search_cjeu", "search_cjeu_by_ecli", "search_gdprhub"
  ];
  assert.deepEqual(tools.map(x => x.name).sort(), expected.sort(), "Połączony serwer musi wystawić dokładnie 10 narzędzi");
  for (const tool of tools) {
    assert.ok(!Object.hasOwn(tool.inputSchema?.properties ?? {}, "lang"), tool.name + " nie może udostępniać selektora języka");
  }

  const result = await client.callTool({ name: "eu_article", arguments: { regulation: "GDPR", article_number: "33" } });
  assert.equal(result.isError, undefined, "Wywołanie offline eu_article musi działać");
  assert.ok(result.content?.[0]?.text?.length > 800, "Zabrakło pełnego pola content dla GDPR art. 33");
  assert.ok(result.structuredContent?.citations?.length >= 1, "Zabrakło structuredContent.citations");
  assert.equal(result.structuredContent?.citations?.[0]?.snapshot_language, "EN",
    "Nie wolno udawać, że angielski snapshot jest polskim tekstem prawa");
  assert.ok(result.structuredContent?.citations?.[0]?.eur_lex_url?.includes("/PL/TXT/"),
    "Odnośnik powinien prowadzić do urzędowej strony PL");

  console.log("OK unified MCP: 10 tools, brak lang, content i citations zachowane, snapshot_language EN");
} finally {
  await client.close();
}
