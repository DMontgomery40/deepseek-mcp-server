# DeepSeek MCP Server (Python Branch)

This branch tracks the Python-native implementation of the **official MCP server for DeepSeek.ai**.

## Branch Navigation

- TypeScript production branch: [`main`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/main)
- Rust branch: [`rust`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/rust)
- Python branch (this branch): [`python`](https://github.com/DMontgomery40/deepseek-mcp-server/tree/python)

## Scope

- MCP server built with `mcp` FastMCP.
- Tool coverage:
  - `chat_completion` -> `POST /chat/completions`
  - `completion` -> `POST /completions`
  - `list_models` -> `GET /models`
  - `get_user_balance` -> `GET /user/balance`
- Compatibility behavior:
  - Reasoner fallback (`deepseek-reasoner` -> fallback model) for retriable failures.
  - `/completions` beta retry when DeepSeek signals beta-only endpoint requirement.
  - Stream and non-stream support for both completion endpoints.

## Install

```bash
cd implementations/python
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
```

## Test

```bash
cd implementations/python
pytest
```

## Live smoke

```bash
cd implementations/python
DEEPSEEK_API_KEY=... python deepseek_mcp_server.py --smoke
```

## Run MCP server

```bash
cd implementations/python
DEEPSEEK_API_KEY=... python deepseek_mcp_server.py
```

Transport options:

- `MCP_TRANSPORT=stdio` (default)
- `MCP_TRANSPORT=streamable-http` with `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_PATH`

## Environment

- `DEEPSEEK_API_KEY` (required)
- `DEEPSEEK_BASE_URL` (default: `https://api.deepseek.com`)
- `DEEPSEEK_DEFAULT_MODEL` (default: `deepseek-chat`)
- `DEEPSEEK_ENABLE_REASONER_FALLBACK` (default: `true`)
- `DEEPSEEK_FALLBACK_MODEL` (default: `deepseek-chat`)
- `DEEPSEEK_REQUEST_TIMEOUT_MS` (default: `120000`)
