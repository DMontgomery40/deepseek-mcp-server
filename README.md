# DeepSeek MCP Server (TypeScript / Node Main)

This `main` branch is the production TypeScript/Node implementation of the official DeepSeek MCP server.

It tracks current DeepSeek API behavior and current MCP SDK patterns while preserving non-breaking compatibility for existing clients.

## Language Branches

- TypeScript (production): [`main`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/main)
- Rust (active track): [`rust`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/rust)
- Python (active track): [`python`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/python)

Language-specific implementation docs:

- Rust implementation details: [`implementations/rust/README.md`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/rust/implementations/rust/README.md)
- Python implementation details: [`implementations/python/README.md`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/python/implementations/python/README.md)

## Status

- Official MCP Registry entry:
  - `io.github.DMontgomery40/deepseek` (active)
- DeepSeek endpoint coverage in this server:
  - `POST /chat/completions`
  - `POST /completions`
  - `GET /models`
  - `GET /user/balance`
- MCP transport support:
  - `stdio` (default)
  - Streamable HTTP (`MCP_TRANSPORT=streamable-http`)
- Runtime compatibility:
  - Node.js `20+` (Node 20/22 are supported)
- Compatibility strategy:
  - Supports both `max_tokens` and `max_completion_tokens`
  - Supports `https://api.deepseek.com` and OpenAI-compatible `https://api.deepseek.com/v1`
  - Auto-retries `POST /completions` on `https://api.deepseek.com/beta` when DeepSeek requires Beta-only completion mode
  - `extra_body` passthrough in tools for forward-compatible request fields
  - Optional reasoner fallback (`deepseek-reasoner` -> `deepseek-chat`) for retriable outages

## Installation

```bash
npm install -g deepseek-mcp-server
```

## Claude Desktop (stdio)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "deepseek": {
      "command": "npx",
      "args": ["-y", "deepseek-mcp-server"],
      "env": {
        "DEEPSEEK_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Environment Variables

```bash
# Required
DEEPSEEK_API_KEY=your-api-key

# DeepSeek API runtime
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_REQUEST_TIMEOUT_MS=120000
DEEPSEEK_DEFAULT_MODEL=deepseek-chat
DEEPSEEK_ENABLE_REASONER_FALLBACK=true
DEEPSEEK_FALLBACK_MODEL=deepseek-chat

# MCP transport
MCP_TRANSPORT=stdio

# Streamable HTTP mode only
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3001
MCP_HTTP_PATH=/mcp
MCP_HTTP_STATEFUL_SESSION=false

# Conversation persistence
CONVERSATION_MAX_MESSAGES=200
```

Notes:

- `DEEPSEEK_BASE_URL` can be either `https://api.deepseek.com` or `https://api.deepseek.com/v1`.
- For `MCP_TRANSPORT=streamable-http`, clients should connect to `http://<host>:<port><path>`.

## Exposed Tools

- `chat_completion`
  - Calls DeepSeek `POST /chat/completions`
  - Supports streaming and non-streaming
  - Supports reasoning content, tool calls, JSON mode, thinking config, and conversation persistence (`conversation_id`)
  - Accepts `extra_body` for forward-compatible request fields
- `completion`
  - Calls DeepSeek `POST /completions`
  - Supports streaming and non-streaming
  - Accepts `extra_body` for forward-compatible request fields
- `list_models`
  - Calls DeepSeek `GET /models`
- `get_user_balance`
  - Calls DeepSeek `GET /user/balance`
- `list_conversations`
  - Lists persisted `conversation_id` values
- `reset_conversation`
  - Clears persisted history for a `conversation_id`

## Exposed Resources

- `deepseek://api/endpoints`
  - Endpoint/tool mapping
- `deepseek://api/runtime`
  - Runtime metadata
- `deepseek://api/models/live`
  - Live data from `GET /models`
- `deepseek://conversations/{conversationId}`
  - Stored chat history for a conversation

## Exposed Prompt

- `deepseek_chat_starter`
  - Helper prompt template for generating consistent chat kickoff messages

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run live DeepSeek smoke tests (requires valid `DEEPSEEK_API_KEY`):

```bash
npm run test:live
```

## Transport Modes

### stdio (default)

```bash
DEEPSEEK_API_KEY=... npm start
```

### Streamable HTTP

```bash
DEEPSEEK_API_KEY=... \
MCP_TRANSPORT=streamable-http \
MCP_HTTP_HOST=127.0.0.1 \
MCP_HTTP_PORT=3001 \
MCP_HTTP_PATH=/mcp \
npm start
```

## Forward-Compatibility Design

- Uses modern MCP registration APIs (`registerTool`, `registerResource`, `registerPrompt`) instead of deprecated forms.
- Keeps request payload assembly explicit and permissive where DeepSeek frequently evolves fields.
- Adds `extra_body` passthrough in endpoint tools to support newly released DeepSeek parameters without requiring immediate server redeploy.
- Maintains stream and non-stream handling for both completion endpoints.

## Language Support Roadmap

The current production implementation is TypeScript/Node-first. We plan to support additional language runtimes in phased rollout (SDK parity, conformance tests, transport matrix, and release automation).

## License

MIT
