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

DeepSeek announced that `deepseek-v4-pro` will begin serving V4.1 Flash on
September 14, 2026 until V4.1 Pro is released.

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
validation before upload. It never reads a caller-supplied local file path.

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
