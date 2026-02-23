# DeepSeek MCP Server (Rust Branch)

This branch tracks the Rust-native implementation of the **official MCP server for DeepSeek.ai**.

## Branch Navigation

- TypeScript production branch: [`main`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/main)
- Rust branch (this branch): [`rust`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/rust)
- Python branch: [`python`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/python)

## What this Rust build includes

- MCP server built with `rmcp` (macro-based tool server + stdio transport).
- Tool parity target with current TS server core endpoints:
  - `list_models` -> `GET /models`
  - `get_user_balance` -> `GET /user/balance`
  - `chat_completion` -> `POST /chat/completions`
  - `completion` -> `POST /completions`
- Compatibility behaviors:
  - Reasoner fallback (`deepseek-reasoner` -> fallback model) on retriable failures.
  - `/completions` retry on beta base URL when DeepSeek indicates beta-only usage.

## Run

```bash
cd implementations/rust
cargo test
cargo run -- --smoke
```

`--smoke` performs a live `/models` call and exits.

## Run as MCP server (stdio)

```bash
cd implementations/rust
cargo run
```

## Environment

- `DEEPSEEK_API_KEY` (required)
- `DEEPSEEK_BASE_URL` (default: `https://api.deepseek.com`)
- `DEEPSEEK_DEFAULT_MODEL` (default: `deepseek-chat`)
- `DEEPSEEK_ENABLE_REASONER_FALLBACK` (default: `true`)
- `DEEPSEEK_FALLBACK_MODEL` (default: `deepseek-chat`)
- `DEEPSEEK_REQUEST_TIMEOUT_MS` (default: `120000`)
