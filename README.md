# DeepSeek MCP Server

<p align="center">
  <img src="https://cdn.deepseek.com/logo.png" alt="DeepSeek logo" width="260" />
</p>

<p align="center">
  As of February 24, 2026, this is the only DeepSeek MCP server repo linked in DeepSeek's official integration list and listed in the official MCP Registry.
</p>

<p align="center">
  <a href="https://github.com/deepseek-ai/awesome-deepseek-integration"><img alt="DeepSeek Official List" src="https://img.shields.io/badge/DeepSeek%20Official%20List-Linked-0A66FF?logo=github&logoColor=white" /></a>
  <a href="https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.DMontgomery40/deepseek"><img alt="Official MCP Registry" src="https://img.shields.io/badge/MCP%20Registry-Official%20Active-0A66FF" /></a>
  <a href="https://www.npmjs.com/package/deepseek-mcp-server"><img alt="npm version" src="https://img.shields.io/npm/v/deepseek-mcp-server?logo=npm" /></a>
  <a href="https://www.npmjs.com/package/deepseek-mcp-server"><img alt="npm downloads" src="https://img.shields.io/npm/dm/deepseek-mcp-server?logo=npm" /></a>
  <a href="https://hub.docker.com/r/dmontgomery40/deepseek-mcp-server"><img alt="Docker pulls" src="https://img.shields.io/docker/pulls/dmontgomery40/deepseek-mcp-server?logo=docker" /></a>
  <a href="https://github.com/DMontgomery40/deepseek-mcp-server"><img alt="GitHub stars" src="https://img.shields.io/github/stars/DMontgomery40/deepseek-mcp-server?logo=github" /></a>
  <a href="https://glama.ai/mcp/servers/asht4rqltn"><img alt="Glama MCP Listing" src="https://img.shields.io/badge/Glama-MCP%20Listing-7B61FF" /></a>
</p>

Official DeepSeek MCP server for chat/completions/models/balance.

- Hosted remote endpoint: `https://deepseek-mcp.ragweld.com/mcp`
- Auth: `Authorization: Bearer <token>`
- Local package and Docker are also supported.

## Quick Install (Copy/Paste)

### 1) Set your hosted token once

```bash
export DEEPSEEK_MCP_AUTH_TOKEN="REPLACE_WITH_TOKEN"
```

### 2) Codex CLI (remote MCP)

```bash
codex mcp add deepseek --url https://deepseek-mcp.ragweld.com/mcp --bearer-token-env-var DEEPSEEK_MCP_AUTH_TOKEN
```

### 3) Claude Code (remote MCP)

```bash
claude mcp add --transport http deepseek https://deepseek-mcp.ragweld.com/mcp --header "Authorization: Bearer $DEEPSEEK_MCP_AUTH_TOKEN"
```

### 4) Cursor (remote MCP)

```bash
node -e 'const fs=require("fs"),p=process.env.HOME+"/.cursor/mcp.json";let j={mcpServers:{}};try{j=JSON.parse(fs.readFileSync(p,"utf8"))}catch{};j.mcpServers={...(j.mcpServers||{}),deepseek:{url:"https://deepseek-mcp.ragweld.com/mcp",headers:{Authorization:"Bearer ${env:DEEPSEEK_MCP_AUTH_TOKEN}"}}};fs.mkdirSync(process.env.HOME+"/.cursor",{recursive:true});fs.writeFileSync(p,JSON.stringify(j,null,2));'
```

### 5) Local install (stdio, if you prefer self-hosted)

```bash
DEEPSEEK_API_KEY="REPLACE_WITH_DEEPSEEK_KEY" npx -y deepseek-mcp-server
```

## Non-Technical Users

If you mostly use chat apps and don’t want terminal setup:

1. Use Cursor’s MCP settings UI and add:
   - URL: `https://deepseek-mcp.ragweld.com/mcp`
   - Header: `Authorization: Bearer <token>`
2. If your app does not support custom remote MCP servers with bearer headers yet, use Codex/Claude Code/Cursor as your MCP-enabled client and keep your usual model provider.

### OpenRouter users (API + chat UI)

OpenRouter now documents MCP usage, but its MCP flow is SDK/client-centric (not “paste URL in chat and done” for most users). Easiest path is: keep OpenRouter for models, and connect this MCP server through an MCP-capable client (Codex/Claude Code/Cursor).

## Remote vs Local (Which Should I Use?)

### Remote server

Use remote if you want the fastest setup and centralized updates.

- Pros: no local server process, easy multi-device use, one shared endpoint.
- Cons: depends on network + hosted token.

### Local server

Use local if you want full runtime control.

- Pros: fully self-managed, easy private-network workflows.
- Cons: you manage updates/secrets/process lifecycle.

## Code Mode / Code Execution (Short Version)

Classic tool calling can waste context because every tool schema and intermediate result gets shoved into the model prompt. Code-mode/code-execution patterns let the model write compact code plans and keep heavy intermediate data out of context, which usually improves cost, latency, and reliability.

## Learn More (Curated)

- Anthropic (Feb 2026): [Introducing Sonnet 4.6](https://www.anthropic.com/news/claude-sonnet-4-6)  
  Why it matters: this is the clearest current Anthropic update that code execution + programmatic tool calling are broadly available.

- Cloudflare (Matt Carey, Feb 2026): [Code Mode: give agents an entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/)  
  Why it matters: very practical code-mode architecture and token-efficiency tradeoffs.

- Anthropic (Jan 2026): [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)  
  Why it matters: concise guidance for testing tool-using agents (including MCP-style agent loops).

- Anthropic Help (updated 2026): [Getting started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)  
  Why it matters: clean product-level explanation of what remote MCP is and when to use it.

- Cursor docs: [Model Context Protocol (MCP)](https://docs.cursor.com/advanced/model-context-protocol)  
  Why it matters: current `mcp.json` setup model for Cursor.

- OpenRouter docs: [Using MCP Servers with OpenRouter](https://openrouter.ai/docs/guides/guides/mcp-servers)  
  Why it matters: current integration path for OpenRouter-centric workflows.

## Registry Identity

- MCP Registry name: `io.github.DMontgomery40/deepseek`

## License

MIT
