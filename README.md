# DeepSeek MCP Server (Python Branch)

This branch is the Python-native track for the official DeepSeek MCP server.

## Branch Navigation

- TypeScript production branch: [`main`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/main)
- Rust branch: [`rust`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/rust)
- Python branch (this branch): [`python`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/python)

## Python Implementation

- Implementation path: [`implementations/python`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/python/implementations/python)
- Implementation docs: [`implementations/python/README.md`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/python/implementations/python/README.md)

Tool surface in this track:

- `list_models` -> `GET /models`
- `get_user_balance` -> `GET /user/balance`
- `chat_completion` -> `POST /chat/completions`
- `completion` -> `POST /completions`

Compatibility behavior in this track:

- Reasoner fallback on retriable failures (`deepseek-reasoner` -> fallback model)
- `/completions` beta retry when DeepSeek signals beta-only requirement
- Streaming and non-streaming handling for chat/completions

## Run (Python)

```bash
cd implementations/python
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
pytest
python deepseek_mcp_server.py --smoke
```

Run as MCP server:

```bash
cd implementations/python
source .venv/bin/activate
python deepseek_mcp_server.py
```

## Context7 Compatibility Baseline

Validated against Context7 sources on February 23, 2026:

- MCP Python SDK FastMCP server/transport guidance (`stdio`, `streamable-http`)
- MCP Rust SDK pattern alignment for cross-branch parity
- DeepSeek API endpoint and base URL/beta semantics

## License

MIT
