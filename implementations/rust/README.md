# Rust Branch Bootstrap

This branch is the Rust track for language-native support of the official DeepSeek MCP server.

## Current Scope

- Live DeepSeek API smoke test (`GET /models`) implemented in Rust.
- Uses `DEEPSEEK_API_KEY` and optional `DEEPSEEK_BASE_URL`.

## Run

```bash
cd implementations/rust
cargo test
cargo run
```

With a valid DeepSeek key, `cargo run` lists available models.
