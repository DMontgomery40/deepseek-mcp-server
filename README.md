# DeepSeek MCP Server

<p align="center">
  <a href="https://github.com/deepseek-ai/awesome-deepseek-integration"><img alt="DeepSeek Official List" src="https://img.shields.io/badge/DeepSeek%20Official%20List-Linked-0A66FF?logo=github&logoColor=white" /></a>
  <a href="https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.DMontgomery40/deepseek"><img alt="Official MCP Registry" src="https://img.shields.io/badge/MCP%20Registry-Official%20Active-0A66FF" /></a>
  <a href="https://www.npmjs.com/package/deepseek-mcp-server"><img alt="npm version" src="https://img.shields.io/npm/v/deepseek-mcp-server?logo=npm" /></a>
  <a href="https://www.npmjs.com/package/deepseek-mcp-server"><img alt="npm downloads" src="https://img.shields.io/npm/dm/deepseek-mcp-server?logo=npm" /></a>
  <a href="https://github.com/DMontgomery40/deepseek-mcp-server/blob/main/server.json"><img alt="Last published OCI package" src="https://img.shields.io/badge/OCI%20(last%20published)-0.5.0-2496ED?logo=docker&logoColor=white" /></a>
  <a href="https://github.com/DMontgomery40/deepseek-mcp-server"><img alt="GitHub stars" src="https://img.shields.io/github/stars/DMontgomery40/deepseek-mcp-server?logo=github" /></a>
  <a href="https://glama.ai/mcp/servers/asht4rqltn"><img alt="Glama MCP Listing" src="https://img.shields.io/badge/Glama-MCP%20Listing-7B61FF" /></a>
</p>

An MCP server for DeepSeek's current V4.1 Flash API: text and visual chat, the
Responses API, FIM completion, Files API lifecycle operations, model discovery,
balance checks, and bounded in-memory conversations.

Version 1.0.0 uses the stable MCP TypeScript SDK v2 and serves both the
2026-07-28 protocol and stateless legacy clients.

## What's current

As of September 10, 2026:

- The canonical fast model is `deepseek-flash`, currently DeepSeek V4.1 Flash.
- `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are temporary aliases
  for `deepseek-flash`.
- DeepSeek announced that `deepseek-v4-pro` will begin serving V4.1 Flash on
  September 14 until V4.1 Pro is released.
- V4.1 Flash accepts visual input through Chat Completions and Responses.
- The Files API supports upload, list, retrieve, and delete for reusable image
  inputs.
- DeepSeek documents a 1M-token context window and up to 384K output tokens for
  `deepseek-flash`.

“Multimodal” here means image understanding. This server does not generate
images, video, or audio.

## Tools

The server exposes eleven tools:

- `chat_completion`: text or visual Chat Completions, thinking controls,
  function tools, JSON output, streaming aggregation, and optional
  `conversation_id` memory.
- `create_response`: stateless Responses API calls with text/images, reasoning
  controls, function/custom tools, web search, structured output, and semantic
  streaming aggregation.
- `completion`: FIM completion through `/beta/completions`.
- `list_models`: live model discovery.
- `get_user_balance`: account availability and balances.
- `upload_file`: upload base64 JPEG, PNG, GIF, or WebP data and receive a
  reusable DeepSeek `file_id`.
- `list_files`: list uploaded files with cursor, order, and purpose filters.
- `retrieve_file`: retrieve metadata for one `file_id`.
- `delete_file`: delete one uploaded file.
- `reset_conversation`: clear one local in-memory conversation.
- `list_conversations`: list local in-memory conversation IDs.

Every tool declares an MCP output schema and behavior annotations. Full
provider payloads remain opt-in through `include_raw_response=true`.

## Install

Node.js 20 or newer is required.

Run directly over stdio:

```bash
DEEPSEEK_API_KEY="REPLACE_WITH_DEEPSEEK_KEY" npx -y deepseek-mcp-server@1
```

Codex CLI:

```bash
codex mcp add deepseek --env DEEPSEEK_API_KEY="REPLACE_WITH_DEEPSEEK_KEY" -- npx -y deepseek-mcp-server@1
```

Claude Code:

```bash
claude mcp add deepseek --env DEEPSEEK_API_KEY="REPLACE_WITH_DEEPSEEK_KEY" -- npx -y deepseek-mcp-server@1
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "deepseek": {
      "command": "npx",
      "args": ["-y", "deepseek-mcp-server@1"],
      "env": {
        "DEEPSEEK_API_KEY": "REPLACE_WITH_DEEPSEEK_KEY"
      }
    }
  }
}
```

## Visual input

`chat_completion` accepts image URLs:

```json
{
  "message": [
    { "type": "text", "text": "Describe this image." },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/photo.png",
        "detail": "high"
      }
    }
  ]
}
```

It also accepts a supported base64 data URL without first uploading it:

```json
{
  "message": [
    { "type": "text", "text": "What is shown here?" },
    {
      "type": "file",
      "file_data": "data:image/png;base64,iVBORw0KGgo...",
      "filename": "image.png"
    }
  ]
}
```

For reuse, call `upload_file`, then pass its returned ID:

```json
{
  "filename": "diagram.png",
  "file_data": "iVBORw0KGgo...",
  "expires_after_seconds": 86400
}
```

```json
{
  "message": [
    { "type": "text", "text": "Explain this diagram." },
    { "type": "file", "file_id": "file-api-..." }
  ]
}
```

The same uploaded file can be used with `create_response`:

```json
{
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Read the image." },
        { "type": "input_image", "file_id": "file-api-..." }
      ]
    }
  ]
}
```

Supported image formats are JPEG, PNG, GIF, and WebP. Detail may be `low`,
`high`, `original`, or `auto`.

### Upload safety boundary

`upload_file` accepts raw base64 or a supported image data URL. It deliberately
does not accept local file paths and does not fetch arbitrary URLs on the
server. The bytes are signature-checked before upload. Uploaded data is stored
by DeepSeek under your account; use an expiry or `delete_file` when it should
not persist. Expiry must be between 3,600 and 2,592,000 seconds.

## Streamable HTTP

Run a local HTTP endpoint:

```bash
DEEPSEEK_API_KEY="REPLACE_WITH_DEEPSEEK_KEY" \
MCP_TRANSPORT=streamable-http \
MCP_HTTP_HOST=127.0.0.1 \
MCP_HTTP_PORT=3001 \
npx -y deepseek-mcp-server@1
```

The endpoint defaults to `http://127.0.0.1:3001/mcp`.

For browser clients, set an exact comma-separated origin allowlist:

```bash
MCP_HTTP_ALLOWED_ORIGINS=https://app.example.com,http://localhost:3000
```

Requests that include an `Origin` header are rejected with `403` unless the
origin is allowlisted. Native clients that omit `Origin` are unaffected.

### Hosted endpoint

A separately deployed endpoint is available at
`https://deepseek-mcp.ragweld.com/mcp` using
`Authorization: Bearer <token>`. The hosted deployment has its own release
cycle and may lag the npm/GitHub release; inspect `tools/list` before relying
on a newly added tool.

## Environment

Required:

```bash
DEEPSEEK_API_KEY=your-api-key
```

Optional:

```bash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_REQUEST_TIMEOUT_MS=120000
DEEPSEEK_DEFAULT_MODEL=deepseek-flash
MCP_TRANSPORT=stdio
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3001
MCP_HTTP_PATH=/mcp
MCP_HTTP_ALLOWED_ORIGINS=https://app.example.com,http://localhost:3000
CONVERSATION_MAX_MESSAGES=200
```

`CONVERSATION_MAX_MESSAGES` bounds the total messages retained in the
process-local conversation store. Restarting the process clears this store.

## MCP compatibility

- Built on `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, and
  `@modelcontextprotocol/client` 2.0.
- Streamable HTTP negotiates MCP 2026-07-28 and falls back to stateless
  2025-era handling for older clients.
- Stdio chooses the protocol era from the opening exchange and pins one server
  instance for that connection.
- Static discovery/list results carry one-hour public cache hints; dynamic
  resource lists, runtime data, live account data, and conversations remain
  private and short-lived or uncached.
- Explicit `conversation_id` memory is application state and works independently
  of transport session state.

### Migrating from 0.6.0

- The default model changed from `deepseek-v4-flash` to `deepseek-flash`.
- The MCP SDK moved from the monolithic v1 package to the split v2 packages.
- `MCP_HTTP_STATEFUL_SESSION` was removed. HTTP protocol handling is now
  per-request/stateless; use `conversation_id` for retained chat context.
- Four Files API tools and visual inputs were added.
- Existing tool names and `include_raw_response` behavior remain compatible.

## Development and verification

```bash
npm ci
npm run build
npm test
npm pack --dry-run
```

Credentialed smoke tests:

```bash
DEEPSEEK_API_KEY="REPLACE_WITH_DEEPSEEK_KEY" npm run test:live
DEEPSEEK_MCP_AUTH_TOKEN="REPLACE_WITH_TOKEN" npm run test:remote
```

The live smoke covers model listing, balance, text chat, thinking streaming,
Responses, FIM, visual input, and a Files upload/retrieve/list/delete lifecycle
with cleanup.

## Registry identity

- MCP Registry: `io.github.DMontgomery40/deepseek`
- npm: `deepseek-mcp-server@1.0.0`
- OCI: `docker.io/dmontgomery40/deepseek-mcp-server:0.5.0` is the last
  published image and does not contain the 1.0.0 feature set.

## Official references

- [DeepSeek V4.1 Flash announcement](https://api-docs.deepseek.com/news/news260910/)
- [DeepSeek pricing and model limits](https://api-docs.deepseek.com/quick_start/pricing/)
- [DeepSeek visual input guide](https://api-docs.deepseek.com/guides/vision/)
- [DeepSeek Files API guide](https://api-docs.deepseek.com/guides/files_api/)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek Responses API](https://api-docs.deepseek.com/api/create-response/)
- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP SDK v2 migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)

## License

MIT
