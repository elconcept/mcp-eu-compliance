# Obraz stacka Portainera "mcp-eu-compliance" (NAS). Serwer z repo mowi tylko stdio - supergateway wystawia go po
# Streamable HTTP (/mcp) bezstanowo: kazde zadanie obsluguje krotki proces potomny, wiec restart kontenera
# nie zrywa sesji klientow (claude.ai, ChatGPT). Zrodla bez zmian; Dockerfile (bez .nas) zostaje dla Glama.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci --ignore-scripts --no-audit --no-fund && npx tsc && npm prune --omit=dev
# Korpus EUR-Lex (~54 MB) wpiekany w obraz z release repo, z kontrola sha256 (ta sama suma co w src/index.ts):
# serwer znajduje go w data/regulations.db i nie pobiera niczego przy starcie.
RUN node -e "const u=\"https://github.com/matematicsolutions/mcp-eu-compliance/releases/download/corpus-v1/regulations.db\";fetch(u).then(r=>{if(!r.ok)throw new Error(\"HTTP \"+r.status);return r.arrayBuffer()}).then(b=>{const d=Buffer.from(b),h=require(\"crypto\").createHash(\"sha256\").update(d).digest(\"hex\");if(h!==\"64e74af9e8f27cbe829bd61682ca739eec17ca10237ef526179277cc119bf1e4\")throw new Error(\"sha256 \"+h);require(\"fs\").mkdirSync(\"data\",{recursive:true});require(\"fs\").writeFileSync(\"data/regulations.db\",d)})"

FROM node:24-bookworm-slim
RUN npm install -g supergateway@4.1.0 --no-audit --no-fund && npm cache clean --force
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
USER 1029:100
ENV NODE_NO_WARNINGS=1
EXPOSE 8000
CMD ["supergateway", "--stdio", "node /app/dist/index.js", "--outputTransport", "streamableHttp", "--port", "8000", "--streamableHttpPath", "/mcp", "--healthEndpoint", "/healthz", "--logLevel", "info"]
