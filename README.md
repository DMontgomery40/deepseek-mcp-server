# DeepSeek MCP Server (Rust Branch)

This branch is the Rust-native track for the official DeepSeek MCP server.

## Branch Navigation

- TypeScript production branch: [`main`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/main)
- Rust branch (this branch): [`rust`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/rust)
- Python branch: [`python`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/python)

## Rust Implementation

- Implementation path: [`implementations/rust`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/rust/implementations/rust)
- Implementation docs: [`implementations/rust/README.md`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/rust/implementations/rust/README.md)

Tool surface in this track:

- `list_models` -> `GET /models`
- `get_user_balance` -> `GET /user/balance`
- `chat_completion` -> `POST /chat/completions`
- `completion` -> `POST /completions`

Compatibility behavior in this track:

- Reasoner fallback on retriable failures (`deepseek-reasoner` -> fallback model)
- `/completions` beta retry when DeepSeek signals beta-only requirement
- Streaming and non-streaming handling for chat/completions

## Run (Rust)

```bash
cd implementations/rust
cargo test
cargo run -- --smoke
```

Run as MCP stdio server:

```bash
cd implementations/rust
cargo run
```

## Context7 Compatibility Baseline

Validated against Context7 sources on February 23, 2026:

- MCP Rust SDK (`rmcp`) macro-based tool server pattern and stdio transport guidance
- MCP Python SDK transport guidance (for cross-branch parity)
- DeepSeek API endpoint and base URL/beta semantics

## License

MIT
