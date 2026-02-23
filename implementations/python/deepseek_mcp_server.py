#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_TIMEOUT_MS = 120000
DEFAULT_MODEL = "deepseek-chat"
DEFAULT_FALLBACK_MODEL = "deepseek-chat"
RETRIABLE_STATUS_CODES = {408, 409, 429, 500, 502, 503, 504}


class DeepSeekApiError(Exception):
    def __init__(self, message: str, *, status: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.payload = payload


@dataclass
class DeepSeekClientConfig:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    timeout_ms: int = DEFAULT_TIMEOUT_MS
    default_model: str = DEFAULT_MODEL
    enable_reasoner_fallback: bool = True
    fallback_model: str = DEFAULT_FALLBACK_MODEL


class DeepSeekApiClient:
    def __init__(self, config: DeepSeekClientConfig) -> None:
        self.config = config

    def list_models(self) -> dict[str, Any]:
        return self._request_json("GET", "/models")

    def get_user_balance(self) -> dict[str, Any]:
        return self._request_json("GET", "/user/balance")

    def create_chat_completion(self, payload: dict[str, Any]) -> dict[str, Any]:
        model = str(payload.get("model") or self.config.default_model)
        payload = dict(payload)
        payload["model"] = model

        try:
            response, stream_chunk_count = self._chat_or_completion_request(
                "/chat/completions", payload
            )
            return {
                "response": response,
                "fallback": None,
                "stream_chunk_count": stream_chunk_count,
            }
        except DeepSeekApiError as error:
            if not self._should_reasoner_fallback(model, error):
                raise

            fallback_payload = dict(payload)
            fallback_payload["model"] = self.config.fallback_model
            response, stream_chunk_count = self._chat_or_completion_request(
                "/chat/completions", fallback_payload
            )
            return {
                "response": response,
                "fallback": {
                    "from_model": model,
                    "to_model": self.config.fallback_model,
                    "reason": str(error),
                },
                "stream_chunk_count": stream_chunk_count,
            }

    def create_completion(self, payload: dict[str, Any]) -> dict[str, Any]:
        payload = dict(payload)
        payload["model"] = str(payload.get("model") or self.config.default_model)

        try:
            response, stream_chunk_count = self._chat_or_completion_request(
                "/completions", payload
            )
            return {
                "response": response,
                "used_beta_base": False,
                "stream_chunk_count": stream_chunk_count,
            }
        except DeepSeekApiError as error:
            if not should_retry_completion_on_beta(error):
                raise

            response, stream_chunk_count = self._chat_or_completion_request(
                "/completions",
                payload,
                base_url_override=build_beta_base_url(self.config.base_url),
            )
            return {
                "response": response,
                "used_beta_base": True,
                "stream_chunk_count": stream_chunk_count,
            }

    def _chat_or_completion_request(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        base_url_override: str | None = None,
    ) -> tuple[dict[str, Any], int | None]:
        if bool(payload.get("stream")):
            chunks = self._request_sse_json(
                "POST", path, body=payload, base_url_override=base_url_override
            )
            if path == "/chat/completions":
                return aggregate_chat_chunks(chunks, str(payload.get("model"))), len(chunks)
            return aggregate_completion_chunks(chunks, str(payload.get("model"))), len(chunks)

        response = self._request_json(
            "POST", path, body=payload, base_url_override=base_url_override
        )
        return response, None

    def _should_reasoner_fallback(self, model: str, error: DeepSeekApiError) -> bool:
        if not self.config.enable_reasoner_fallback:
            return False
        if model != "deepseek-reasoner":
            return False
        if self.config.fallback_model == model:
            return False
        if error.status is None:
            return True
        return error.status in RETRIABLE_STATUS_CODES

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        base_url_override: str | None = None,
    ) -> dict[str, Any]:
        base_url = normalize_base_url(base_url_override or self.config.base_url)
        url = f"{base_url}{path}"

        with httpx.Client(timeout=self.config.timeout_ms / 1000.0) as client:
            response = client.request(
                method,
                url,
                headers=self._headers(accept="application/json"),
                json=body,
            )

        if response.status_code >= 400:
            raise make_api_error(response)

        try:
            return response.json()
        except ValueError as error:
            raise DeepSeekApiError(
                f"DeepSeek API returned invalid JSON: {error}", status=response.status_code
            ) from error

    def _request_sse_json(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        base_url_override: str | None = None,
    ) -> list[dict[str, Any]]:
        base_url = normalize_base_url(base_url_override or self.config.base_url)
        url = f"{base_url}{path}"

        with httpx.Client(timeout=self.config.timeout_ms / 1000.0) as client:
            with client.stream(
                method,
                url,
                headers=self._headers(accept="text/event-stream"),
                json=body,
            ) as response:
                if response.status_code >= 400:
                    text = response.read().decode("utf-8", errors="replace")
                    raise make_api_error_from_text(response.status_code, text)

                chunks: list[dict[str, Any]] = []
                for line in response.iter_lines():
                    if not line:
                        continue
                    if not line.startswith("data:"):
                        continue

                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break

                    try:
                        chunks.append(json.loads(data))
                    except json.JSONDecodeError:
                        continue

        return chunks

    def _headers(self, *, accept: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
            "Accept": accept,
            "User-Agent": "deepseek-mcp-python/0.1.0",
        }


def normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def build_beta_base_url(base_url: str) -> str:
    normalized = normalize_base_url(base_url)
    if normalized.endswith("/beta"):
        return normalized
    return f"{normalized}/beta"


def should_retry_completion_on_beta(error: DeepSeekApiError) -> bool:
    text = str(error).lower()
    return any(token in text for token in ("beta", "base url", "base_url", "/beta"))


def make_api_error(response: httpx.Response) -> DeepSeekApiError:
    try:
        payload = response.json()
    except ValueError:
        payload = None

    message = extract_error_message(payload) if payload is not None else response.text
    if not message:
        message = f"DeepSeek API error (status {response.status_code})"

    return DeepSeekApiError(message, status=response.status_code, payload=payload)


def make_api_error_from_text(status_code: int, text: str) -> DeepSeekApiError:
    payload = None
    message = text

    try:
        payload = json.loads(text)
        message = extract_error_message(payload) or message
    except json.JSONDecodeError:
        pass

    if not message:
        message = f"DeepSeek API error (status {status_code})"

    return DeepSeekApiError(message, status=status_code, payload=payload)


def extract_error_message(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None

    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            return message

    message = payload.get("message")
    if isinstance(message, str):
        return message

    return None


def aggregate_chat_chunks(chunks: list[dict[str, Any]], fallback_model: str) -> dict[str, Any]:
    if not chunks:
        return {
            "id": f"chatcmpl-stream-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": fallback_model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": ""},
                    "finish_reason": None,
                }
            ],
            "usage": None,
        }

    first = chunks[0]
    last = chunks[-1]
    model = str(first.get("model") or fallback_model)

    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    finish_reason = None

    for chunk in chunks:
        for choice in chunk.get("choices", []) or []:
            delta = choice.get("delta") or {}
            text = delta.get("content")
            if isinstance(text, str):
                content_parts.append(text)

            reasoning = delta.get("reasoning_content")
            if isinstance(reasoning, str):
                reasoning_parts.append(reasoning)

            finish_reason = choice.get("finish_reason") or finish_reason

    message: dict[str, Any] = {
        "role": "assistant",
        "content": "".join(content_parts),
    }
    if reasoning_parts:
        message["reasoning_content"] = "".join(reasoning_parts)

    return {
        "id": first.get("id") or f"chatcmpl-stream-{int(time.time())}",
        "object": "chat.completion",
        "created": last.get("created") or first.get("created") or int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }
        ],
        "usage": last.get("usage"),
    }


def aggregate_completion_chunks(chunks: list[dict[str, Any]], fallback_model: str) -> dict[str, Any]:
    if not chunks:
        return {
            "id": f"cmpl-stream-{int(time.time())}",
            "object": "text_completion",
            "created": int(time.time()),
            "model": fallback_model,
            "choices": [{"index": 0, "text": "", "finish_reason": None}],
            "usage": None,
        }

    first = chunks[0]
    last = chunks[-1]
    model = str(first.get("model") or fallback_model)

    text_parts: list[str] = []
    finish_reason = None

    for chunk in chunks:
        for choice in chunk.get("choices", []) or []:
            delta_text = choice.get("text")
            if isinstance(delta_text, str):
                text_parts.append(delta_text)
            finish_reason = choice.get("finish_reason") or finish_reason

    return {
        "id": first.get("id") or f"cmpl-stream-{int(time.time())}",
        "object": "text_completion",
        "created": last.get("created") or first.get("created") or int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "text": "".join(text_parts),
                "finish_reason": finish_reason,
            }
        ],
        "usage": last.get("usage"),
    }


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@lru_cache(maxsize=1)
def get_client() -> DeepSeekApiClient:
    load_dotenv()

    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is required")

    timeout_ms_raw = os.getenv("DEEPSEEK_REQUEST_TIMEOUT_MS", str(DEFAULT_TIMEOUT_MS))
    try:
        timeout_ms = int(timeout_ms_raw)
    except ValueError:
        timeout_ms = DEFAULT_TIMEOUT_MS

    config = DeepSeekClientConfig(
        api_key=api_key,
        base_url=os.getenv("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL),
        timeout_ms=timeout_ms,
        default_model=os.getenv("DEEPSEEK_DEFAULT_MODEL", DEFAULT_MODEL),
        enable_reasoner_fallback=env_bool("DEEPSEEK_ENABLE_REASONER_FALLBACK", True),
        fallback_model=os.getenv("DEEPSEEK_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL),
    )
    return DeepSeekApiClient(config)


mcp = FastMCP("DeepSeek MCP Server (Python)", json_response=True)

ENDPOINT_MATRIX = [
    {
        "endpoint": "/chat/completions",
        "method": "POST",
        "tool": "chat_completion",
        "description": "Chat Completions API (streaming and non-streaming)",
    },
    {
        "endpoint": "/completions",
        "method": "POST",
        "tool": "completion",
        "description": "Text/FIM Completions API (streaming and non-streaming)",
    },
    {
        "endpoint": "/models",
        "method": "GET",
        "tool": "list_models",
        "description": "List available DeepSeek models",
    },
    {
        "endpoint": "/user/balance",
        "method": "GET",
        "tool": "get_user_balance",
        "description": "Retrieve account balance",
    },
]


@mcp.resource("deepseek://api/endpoints")
def api_endpoints_resource() -> str:
    return json.dumps({"endpoints": ENDPOINT_MATRIX}, indent=2)


@mcp.prompt()
def deepseek_chat_starter(task: str, style: str = "helpful", model: str = DEFAULT_MODEL) -> str:
    return f"Use model: {model}\nStyle: {style}\nTask: {task}"


@mcp.tool()
def list_models() -> dict[str, Any]:
    return get_client().list_models()


@mcp.tool()
def get_user_balance() -> dict[str, Any]:
    return get_client().get_user_balance()


@mcp.tool()
def chat_completion(
    messages: list[dict[str, Any]],
    model: str | None = None,
    stream: bool = False,
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    max_completion_tokens: int | None = None,
    stop: str | list[str] | None = None,
    response_format: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict[str, Any] | None = None,
    thinking: dict[str, Any] | None = None,
    extra_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "messages": messages,
        "stream": stream,
    }

    if model:
        payload["model"] = model
    if temperature is not None:
        payload["temperature"] = temperature
    if top_p is not None:
        payload["top_p"] = top_p
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if max_completion_tokens is not None:
        payload["max_completion_tokens"] = max_completion_tokens
    if stop is not None:
        payload["stop"] = stop
    if response_format is not None:
        payload["response_format"] = response_format
    if tools is not None:
        payload["tools"] = tools
    if tool_choice is not None:
        payload["tool_choice"] = tool_choice
    if thinking is not None:
        payload["thinking"] = thinking
    if extra_body:
        payload.update(extra_body)

    return get_client().create_chat_completion(payload)


@mcp.tool()
def completion(
    prompt: str,
    model: str | None = None,
    stream: bool = False,
    suffix: str | None = None,
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    stop: str | list[str] | None = None,
    extra_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "prompt": prompt,
        "stream": stream,
    }

    if model:
        payload["model"] = model
    if suffix is not None:
        payload["suffix"] = suffix
    if temperature is not None:
        payload["temperature"] = temperature
    if top_p is not None:
        payload["top_p"] = top_p
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if stop is not None:
        payload["stop"] = stop
    if extra_body:
        payload.update(extra_body)

    return get_client().create_completion(payload)


def run_smoke() -> int:
    try:
        models = get_client().list_models()
    except Exception as error:
        print(f"Smoke test failed: {error}")
        return 1

    print("Python MCP smoke test OK. Available models:")
    for item in models.get("data", []):
        model_id = item.get("id")
        if isinstance(model_id, str):
            print(f"- {model_id}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="DeepSeek MCP Server (Python track)")
    parser.add_argument("--smoke", action="store_true", help="Run live /models smoke test and exit")
    args = parser.parse_args()

    if args.smoke:
        return run_smoke()

    transport = os.getenv("MCP_TRANSPORT", "stdio")
    if transport not in {"stdio", "streamable-http"}:
        raise RuntimeError(f"Unsupported MCP_TRANSPORT: {transport}")

    if transport == "streamable-http":
        host = os.getenv("MCP_HTTP_HOST", "127.0.0.1")
        port = int(os.getenv("MCP_HTTP_PORT", "3001"))
        path = os.getenv("MCP_HTTP_PATH", "/mcp")
        mcp.run(transport="streamable-http", host=host, port=port, path=path)
        return 0

    mcp.run(transport="stdio")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
