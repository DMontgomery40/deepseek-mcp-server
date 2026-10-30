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

An MCP server for DeepSeek V4.1 Flash and V4 Pro APIs: text and visual chat, the
Responses API, FIM completion, Files API lifecycle operations, model discovery,
balance checks, and bounded in-memory conversations.

Version 1.4.1 uses the stable MCP TypeScript SDK v2 and serves both the
2026-07-28 protocol and stateless legacy clients.

## What's current

Checked against the official API docs on October 19, 2026:

- The canonical fast model is `deepseek-flash`, now served by
  DeepSeek-V4.1-Flash-1017. The October 17 model update did not change its API
  calling method or model-token pricing.
- `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are temporary aliases
  for `deepseek-flash`.
- `deepseek-v4-pro` continues serving V4 Pro 0813. DeepSeek reversed its
  announced September rerouting plan; Pro remains available with unchanged billing.
- V4.1 Flash accepts visual input through Chat Completions and Responses.
  V4 Pro accepts text input. Use `list_models` to check your account's live availability.
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
  controls, function tools, the `apply_patch` custom tool, structured output, and semantic
  streaming aggregation.
- `completion`: FIM completion through `/beta/completions`.
- `list_models`: live model discovery, including display names, context/output
  limits, input/output modalities, effort levels, and API capabilities.
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

## API behavior

- Thinking is enabled by default. Canonical reasoning efforts are `none`,
  `low`, `high`, and `max`. Compatibility aliases are accepted: `minimal` maps
  to `low`; `medium` and `xhigh` map to `high`; the thinking guide also accepts
  `ultra` as an alias for `max`.
- Chat `stream_options` requires `stream=true`. Chat forced tool choices
  (`required` or a named function) require thinking to be disabled.
- Chat prefix completion (`prefix=true`) and strict function tools
  (`strict=true`) automatically use `/beta/chat/completions`. Configured `/v1`
  and `/beta` bases are normalized for beta requests.
- Frequency and presence penalties remain accepted for compatibility, but
  DeepSeek ignores them.
- Responses calls are stateless: send full input history. `web_search` runs
  server-side with `deepseek-v4-pro`; DeepSeek ignores it with `deepseek-flash`.
  Other built-in tool types such as `file_search`, `code_interpreter`, and `mcp`
  are ignored. The supported custom tool is
  `{ "type": "custom", "name": "apply_patch" }`. Returned calls appear in
  `custom_tool_calls`; the client is responsible for executing them and
  sending `custom_tool_call_output` history. `output_items` preserves complete
  returned reasoning, message, and tool-call items for replay without enabling
  the full raw provider response.
- FIM is beta and non-thinking. It supports streaming usage options;
  `echo=true` cannot accompany `suffix` or `logprobs`. Its guide documents a
  4K output limit, so do not assume the Chat output ceiling applies.
- `DEEPSEEK_REQUEST_TIMEOUT_MS` applies to the complete request, including
  reading the response body and streaming output. Streams are aggregated
  into one MCP result; partial tokens are not forwarded as MCP notifications.

## Search and Fetch billing notice

DeepSeek opened separate [Search and Fetch APIs](https://api-docs.deepseek.com/guides/search/)
on October 17, 2026. Each costs **$0.75 per 1,000 successful requests**, billed
by request rather than tokens or result count. A request is billable only if it
returns HTTP 200 with a non-empty Search result or Fetch page content. These
charges are separate from model-token charges.

DeepSeek says Search and Fetch calls made through server-side tools in
**DeepSeek Harness, Claude Code, and Codex** are temporarily free for DeepSeek
API users; per-request billing starts **October 31, 2026 at 16:00 UTC**
(November 1 at 00:00 Beijing time). This announced waiver names those clients;
do not assume it covers other integrations. Check DeepSeek's current pricing
before enabling search in an agent.

This MCP server does not expose standalone Search or Fetch tools. Its
`create_response` tool already accepts `web_search` for Pro, which DeepSeek
runs on its server; Flash ignores it. The new raw JSON endpoints are
`POST /v1/tools/search` and `POST /v1/tools/fetch`. The server's
`MCP_TOOL_RATE_LIMIT` limits MCP invocations, not DeepSeek spending.

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

### Image limits

Inline images are limited to 32 MiB each, uploaded Files to 64 MiB, JSON
request bodies to 48 MiB, and requests to 600 images. Local validation checks
known inline sizes, image counts, and serialized UTF-8 body size. DeepSeek
checks remote/downloaded and uploaded-file dimensions and aggregate sizes:
64 MiB total without file references, or 200 MiB including them. Dimensions
are limited to 8192 pixels per side, dropping to 4096 when there are at least
15 images. External downloads must complete within 60 seconds.

The server does not fetch image URLs or read file metadata just to preflight
these provider-side limits. Use the Files API for large or reused images.

### Upload safety boundary

`upload_file` accepts raw base64 or a supported image data URL. It deliberately
does not accept local file paths and does not fetch arbitrary URLs on the
server. Decoded uploads are limited to 64 MiB, and the bytes are
signature-checked before upload. Uploaded data is stored by DeepSeek under your
account; use an expiry or `delete_file` when it should not persist. Expiry must
be between 3,600 and 2,592,000 seconds. DeepSeek storage is limited to 25 GiB
and 10,000 files per user. Its upload deadline is ten minutes; increase
`DEEPSEEK_REQUEST_TIMEOUT_MS` for large uploads when needed.

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

### HTTP authentication and admission limits

Local HTTP binds to loopback by default. To protect it with a shared bearer
token, set `MCP_HTTP_AUTH_TOKEN`; callers then send `Authorization: Bearer <token>`.
This is shared-token access control, not an OAuth authorization server.

Non-loopback binds now require either `MCP_HTTP_AUTH_TOKEN` or
`MCP_HTTP_TRUST_AUTH_GATEWAY=true`. Use gateway mode only when a reverse proxy
authenticates every MCP request and prevents direct access to the backend.
A browser origin allowlist is independent of authentication. Hosted installations
upgrading from 1.0.1 must explicitly configure one of these authentication paths.

`MCP_TOOL_RATE_LIMIT` defaults to 120 invocations per 60-second window, shared
across all tools and stateless HTTP request instances using the same provider
client. Rate-limit responses are MCP tool errors with `error_type=tool_rate_limit`
and `retryable=true`; denied calls do not reach DeepSeek or alter conversations.

MCP cancellation reaches the provider request. Cancelled replies are not saved
to conversation history. Reading a missing conversation resource returns the
protocol's `-32602` error. Resource list-change notifications are not advertised.

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
MCP_HTTP_AUTH_TOKEN=
MCP_HTTP_TRUST_AUTH_GATEWAY=false
MCP_TOOL_RATE_LIMIT=120
CONVERSATION_MAX_MESSAGES=200
```

`CONVERSATION_MAX_MESSAGES` bounds the messages retained per conversation in
the process-local store. Restarting the process clears this store.

## MCP compatibility

- Built on `@modelcontextprotocol/server` and `@modelcontextprotocol/client`
  2.3.1, with `@modelcontextprotocol/node` 2.1.1.
- Modern MCP 2026-07-28 is stateless: discovery uses `server/discover`,
  requests carry protocol version and client capabilities in `_meta`, and
  completed results carry `resultType` and required caching fields. The SDK
  validates the corresponding HTTP headers. Stateless 2025-era handling
  remains available for older clients.
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

## Release 1.4.1

Preserves leading system instructions and removes orphaned tool results when
conversation history reaches its configured cap. Refreshes the MCP Node adapter
and locks `@hono/node-server` to 2.1.5 to clear GHSA-rmxm-3fg6-px4f. This server
does not use the affected `serveStatic` helper. HTTP startup supplies Node's Web
Crypto only when the global is missing. Node >=20 support is unchanged.

## Release 1.4.0

This release refreshes MCP dependencies, corrects Pro availability and Responses
capabilities, adds `apply_patch` custom-tool results and FIM usage options, and
fixes beta routing, end-to-end request deadlines, split CRLF SSE boundaries,
stream error handling, and non-JSON provider errors. Existing tool names and
opt-in raw responses are preserved. The complete API/MCP audit also adds
vision request limits, complete Responses history, cancellation propagation,
truthful capabilities, missing-resource errors, tool admission limits,
reflected-credential redaction, and explicit remote HTTP authentication.
`DEEPSEEK_DEFAULT_MODEL` is now honored by all three generation tools.

Earlier 1.1.0–1.3.0 version identifiers were historically published and removed;
npm cannot reuse them. The next available minor release is 1.4.0.

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
Responses, strict beta function calling, `apply_patch` custom-tool calls, FIM,
visual input, and a Files upload/retrieve/list/delete lifecycle with cleanup.

## Registry identity

- MCP Registry: `io.github.DMontgomery40/deepseek`
- npm: `deepseek-mcp-server@1.4.1`
- OCI: `docker.io/dmontgomery40/deepseek-mcp-server:0.5.0` is the last
  published image and does not contain the current npm feature set.

## Documentation audit

The release audit covers every supported DeepSeek endpoint reference and its
current guides, plus all 31 pages and the authoritative schema of MCP
2026-07-28. Findings, coverage, source conflicts, optional capabilities, and
verification limits are recorded in [the API audit](docs/research/2026-10-13-api-mcp-update.md)
and [the MCP audit](docs/research/2026-10-13-mcp-spec-audit.md). Anthropic-format
provider APIs were read for context; this server exposes the OpenAI-compatible
Chat, Responses, FIM, Files, model, and balance routes.

## Official references

- [DeepSeek changelog](https://api-docs.deepseek.com/updates/)
- [DeepSeek October 17 announcement](https://api-docs.deepseek.com/news/news261017/)
- [DeepSeek Search and Fetch guide and billing](https://api-docs.deepseek.com/guides/search/)
- [DeepSeek Responses compatibility guide](https://api-docs.deepseek.com/guides/responses_api/)
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
