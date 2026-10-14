# DeepSeek V4.1 Flash API Notes

Sources:

- <https://api-docs.deepseek.com/news/news260910/>
- <https://api-docs.deepseek.com/guides/vision/>
- <https://api-docs.deepseek.com/guides/files_api/>
- <https://api-docs.deepseek.com/api>

Current canonical model:

- `deepseek-flash` (DeepSeek V4.1 Flash)

Temporary compatibility aliases:

- `deepseek-v4-flash`
- `deepseek-v4-flash-vision-exp`

Checked October 13, 2026: `deepseek-v4-pro` continues serving V4 Pro 0813.
DeepSeek reversed its announced September rerouting plan. Vision is Flash-only.

## Chat

```http
POST https://api.deepseek.com/chat/completions
```

Text:

```json
{
  "model": "deepseek-flash",
  "messages": [{ "role": "user", "content": "Reply with hello" }],
  "thinking": { "type": "disabled" }
}
```

Visual URL:

```json
{
  "model": "deepseek-flash",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Describe the image." },
        {
          "type": "image_url",
          "image_url": {
            "url": "https://example.com/image.png",
            "detail": "high"
          }
        }
      ]
    }
  ]
}
```

Visual file:

```json
{
  "model": "deepseek-flash",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Read the image." },
        { "type": "file", "file_id": "file-api-..." }
      ]
    }
  ]
}
```

Thinking can be enabled or disabled. Current reasoning effort values accepted
by this server are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`,
and `max`.

## Responses

```http
POST https://api.deepseek.com/responses
```

```json
{
  "model": "deepseek-flash",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Describe this." },
        { "type": "input_image", "file_id": "file-api-..." }
      ]
    }
  ],
  "reasoning": { "effort": "low" }
}
```

The Responses endpoint is stateless. Send the full input history for multi-turn
work. Streaming ends with `response.completed`, `response.incomplete`, or
`response.failed`.

## Files

```http
POST   https://api.deepseek.com/files
GET    https://api.deepseek.com/files
GET    https://api.deepseek.com/files/{file_id}
DELETE https://api.deepseek.com/files/{file_id}
```

Uploads use multipart form data with `purpose=user_data`. This MCP server
accepts raw base64 or a JPEG/PNG/GIF/WebP data URL and performs signature
validation before upload. Decoded uploads are limited to 64 MiB. It never reads
a caller-supplied local file path.

## FIM

```http
POST https://api.deepseek.com/beta/completions
```

```json
{
  "model": "deepseek-flash",
  "prompt": "const answer = ",
  "suffix": ";",
  "max_tokens": 32
}
```

## MCP tools

- `chat_completion`
- `create_response`
- `completion`
- `list_models`
- `get_user_balance`
- `upload_file`
- `list_files`
- `retrieve_file`
- `delete_file`
- `reset_conversation`
- `list_conversations`

This server supports MCP 2026-07-28 and stateless legacy clients.

## Current API constraints

Canonical reasoning efforts: none, low, high, max. Aliases: minimal maps to low;
medium and xhigh map to high. DeepSeek ignores frequency/presence penalties.
Chat and FIM stream_options require stream=true. FIM echo=true cannot accompany
suffix or logprobs. Prefix and strict Chat requests automatically use the beta
route. Request timeouts include response bodies and streamed output.

Responses built-in tools, including web search, are ignored by DeepSeek.
The supported custom tool is {"type":"custom","name":"apply_patch"}.
The MCP result returns custom_tool_calls without requiring raw_response; the
client executes these calls and supplies custom_tool_call_output history.

Sources:
https://api-docs.deepseek.com/updates/
https://api-docs.deepseek.com/guides/responses_api/
https://api-docs.deepseek.com/api/create-completion/

## Full-audit release behavior

The thinking guide accepts ultra as a compatibility alias of max. Model discovery
includes names, context/output limits, modalities, effort levels, and API capabilities.
Responses output_items preserves complete returned items for full-history replay.
Inline images: 32 MiB each; JSON bodies: 48 MiB; max images/request: 600.
Files images: 64 MiB each. DeepSeek validates remote/file dimensions and total
image bytes (64 MiB without file IDs, 200 MiB with file IDs).
Uploads may take up to 10 minutes; increase the request timeout for large files.

MCP_TOOL_RATE_LIMIT=120 limits tool invocations per 60-second window.
MCP_HTTP_AUTH_TOKEN protects HTTP with a shared bearer token. Non-loopback
binds require this token or explicit MCP_HTTP_TRUST_AUTH_GATEWAY=true behind
a gateway that authenticates every request. Origin validation is separate.
Cancellation stops provider work and cancelled replies do not update history.
Missing conversation resources return -32602; list-change notifications are
not advertised. CONVERSATION_MAX_MESSAGES is a per-conversation bound.
