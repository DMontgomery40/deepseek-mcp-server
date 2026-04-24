# DeepSeek MCP Server

<p align="center">
  <a href="https://github.com/deepseek-ai/awesome-deepseek-integration"><img alt="DeepSeek Official List" src="https://img.shields.io/badge/DeepSeek%20Official%20List-Linked-0A66FF?logo=github&logoColor=white" /></a>
  <a href="https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.DMontgomery40/deepseek"><img alt="Official MCP Registry" src="https://img.shields.io/badge/MCP%20Registry-Official%20Active-0A66FF" /></a>
  <a href="https://www.npmjs.com/package/deepseek-mcp-server"><img alt="npm version" src="https://img.shields.io/npm/v/deepseek-mcp-server?logo=npm" /></a>
  <a href="https://www.npmjs.com/package/deepseek-mcp-server"><img alt="npm downloads" src="https://img.shields.io/npm/dm/deepseek-mcp-server?logo=npm" /></a>
  <a href="https://github.com/DMontgomery40/deepseek-mcp-server/blob/main/server.json"><img alt="OCI package" src="https://img.shields.io/badge/OCI-docker.io%2Fdmontgomery40%2Fdeepseek--mcp--server%3A0.5.0-2496ED?logo=docker&logoColor=white" /></a>
  <a href="https://github.com/DMontgomery40/deepseek-mcp-server"><img alt="GitHub stars" src="https://img.shields.io/github/stars/DMontgomery40/deepseek-mcp-server?logo=github" /></a>
  <a href="https://glama.ai/mcp/servers/asht4rqltn"><img alt="Glama MCP Listing" src="https://img.shields.io/badge/Glama-MCP%20Listing-7B61FF" /></a>
  <a href="https://spark.entire.vc/assets/vb-deepseek-mcp-server?utm_source=github&utm_medium=readme"><img alt="Listed on Spark" src="https://spark.entire.vc/badges/listed.svg" /></a>
  <a href="https://spark.entire.vc/assets/vb-deepseek-mcp-server?utm_source=github&utm_medium=readme"><img alt="Install via Spark" src="https://spark.entire.vc/badges/vb-deepseek-mcp-server/install.svg" /></a>
</p>

Model Context Protocol server for the current DeepSeek V4 API.

As of April 24, 2026, DeepSeek's public API reference documents:

- `POST /chat/completions` with `deepseek-v4-flash` and `deepseek-v4-pro`
- `POST /beta/completions` for V4 Pro FIM completion
- `GET /models`
- `GET /user/balance`

This server exposes only those documented API surfaces. It does not ship a V4 monitor, speculative image/video/upload tools, or automatic model substitution.

## Tools

- `chat_completion`: DeepSeek V4 chat. Defaults to `deepseek-v4-flash`. Supports `thinking: { "type": "enabled" | "disabled" }`, `reasoning_effort: "high" | "max"`, JSON output, function tools, logprobs, streaming, and conversation memory.
- `completion`: DeepSeek V4 Pro FIM completion. Defaults to `deepseek-v4-pro`.
- `list_models`: Reads the live DeepSeek model list.
- `get_user_balance`: Reads account balance and availability.
- `reset_conversation`: Clears an in-memory conversation.
- `list_conversations`: Lists in-memory conversation IDs.

## Hosted Remote

- URL: `https://deepseek-mcp.ragweld.com/mcp`
- Auth: `Authorization: Bearer <token>`

Codex CLI:

```bash
export DEEPSEEK_MCP_AUTH_TOKEN="REPLACE_WITH_TOKEN"
codex mcp add deepseek --url https://deepseek-mcp.ragweld.com/mcp --bearer-token-env-var DEEPSEEK_MCP_AUTH_TOKEN
```

Claude Code:

```bash
export DEEPSEEK_MCP_AUTH_TOKEN="REPLACE_WITH_TOKEN"
claude mcp add --transport http deepseek https://deepseek-mcp.ragweld.com/mcp --header "Authorization: Bearer $DEEPSEEK_MCP_AUTH_TOKEN"
```

Cursor:

```bash
node -e 'const fs=require("fs"),p=process.env.HOME+"/.cursor/mcp.json";let j={mcpServers:{}};try{j=JSON.parse(fs.readFileSync(p,"utf8"))}catch{};j.mcpServers={...(j.mcpServers||{}),deepseek:{url:"https://deepseek-mcp.ragweld.com/mcp",headers:{Authorization:"Bearer ${env:DEEPSEEK_MCP_AUTH_TOKEN}"}}};fs.mkdirSync(process.env.HOME+"/.cursor",{recursive:true});fs.writeFileSync(p,JSON.stringify(j,null,2));'
```

## Local Stdio

```bash
DEEPSEEK_API_KEY="REPLACE_WITH_DEEPSEEK_KEY" npx -y deepseek-mcp-server
```

Docker:

```bash
docker pull docker.io/dmontgomery40/deepseek-mcp-server:0.5.0
docker run --rm -i -e DEEPSEEK_API_KEY="REPLACE_WITH_DEEPSEEK_KEY" docker.io/dmontgomery40/deepseek-mcp-server:0.5.0
```

## Environment

Required:

```bash
DEEPSEEK_API_KEY=your-api-key
```

Optional:

```bash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_REQUEST_TIMEOUT_MS=120000
DEEPSEEK_DEFAULT_MODEL=deepseek-v4-flash
MCP_TRANSPORT=stdio
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3001
MCP_HTTP_PATH=/mcp
MCP_HTTP_STATEFUL_SESSION=false
CONVERSATION_MAX_MESSAGES=200
```

## Verification

```bash
npm run build
npm test
DEEPSEEK_API_KEY="REPLACE_WITH_DEEPSEEK_KEY" npm run test:live
DEEPSEEK_MCP_AUTH_TOKEN="REPLACE_WITH_TOKEN" npm run test:remote
```

The live smoke test performs real DeepSeek requests for model listing, balance, non-thinking chat, thinking streaming chat with `reasoning_content`, FIM completion, and MCP tool calls.

## Registry Identity

- MCP Registry name: `io.github.DMontgomery40/deepseek`
- npm package: `deepseek-mcp-server`
- OCI package: `docker.io/dmontgomery40/deepseek-mcp-server:0.5.0`

## Official References

- DeepSeek chat completions: <https://api-docs.deepseek.com/api/create-chat-completion>
- DeepSeek FIM completions: <https://api-docs.deepseek.com/api/create-completion>
- DeepSeek models: <https://api-docs.deepseek.com/api/list-models>
- DeepSeek balance: <https://api-docs.deepseek.com/api/get-user-balance>
- MCP specification: <https://modelcontextprotocol.io/specification/2025-11-25>

## License

MIT
