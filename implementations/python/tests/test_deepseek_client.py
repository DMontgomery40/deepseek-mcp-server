from deepseek_mcp_server import (
    DeepSeekApiError,
    aggregate_chat_chunks,
    aggregate_completion_chunks,
    build_beta_base_url,
    normalize_base_url,
    should_retry_completion_on_beta,
)


def test_normalize_base_url_trims_trailing_slash() -> None:
    assert normalize_base_url("https://api.deepseek.com/") == "https://api.deepseek.com"
    assert normalize_base_url("https://api.deepseek.com") == "https://api.deepseek.com"


def test_build_beta_base_url_stable() -> None:
    assert build_beta_base_url("https://api.deepseek.com") == "https://api.deepseek.com/beta"
    assert (
        build_beta_base_url("https://api.deepseek.com/beta")
        == "https://api.deepseek.com/beta"
    )


def test_should_retry_completion_on_beta() -> None:
    error = DeepSeekApiError("Please use https://api.deepseek.com/beta for this endpoint", status=400)
    assert should_retry_completion_on_beta(error)


def test_aggregate_chat_chunks_collects_content() -> None:
    chunks = [
        {
            "id": "abc",
            "created": 1,
            "model": "deepseek-chat",
            "choices": [{"index": 0, "delta": {"role": "assistant", "content": "HELLO_"}}],
        },
        {
            "id": "abc",
            "created": 2,
            "model": "deepseek-chat",
            "choices": [{"index": 0, "delta": {"content": "WORLD"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        },
    ]

    result = aggregate_chat_chunks(chunks, "deepseek-chat")
    assert result["choices"][0]["message"]["content"] == "HELLO_WORLD"
    assert result["choices"][0]["finish_reason"] == "stop"


def test_aggregate_completion_chunks_collects_text() -> None:
    chunks = [
        {
            "id": "cmpl-1",
            "created": 10,
            "model": "deepseek-chat",
            "choices": [{"index": 0, "text": "foo"}],
        },
        {
            "id": "cmpl-1",
            "created": 11,
            "model": "deepseek-chat",
            "choices": [{"index": 0, "text": "bar", "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 2, "completion_tokens": 2, "total_tokens": 4},
        },
    ]

    result = aggregate_completion_chunks(chunks, "deepseek-chat")
    assert result["choices"][0]["text"] == "foobar"
    assert result["choices"][0]["finish_reason"] == "stop"
