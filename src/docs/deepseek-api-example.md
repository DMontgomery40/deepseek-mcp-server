# DeepSeek V4 API Notes

Source: <https://api-docs.deepseek.com/api>

Current documented model IDs:

- `deepseek-v4-flash`
- `deepseek-v4-pro`

## Chat

Endpoint:

```http
POST https://api.deepseek.com/chat/completions
```

Minimal non-thinking request:

```json
{
  "model": "deepseek-v4-flash",
  "messages": [{ "role": "user", "content": "Reply with hello" }],
  "thinking": { "type": "disabled" }
}
```

Thinking request:

```json
{
  "model": "deepseek-v4-flash",
  "messages": [{ "role": "user", "content": "Solve 19 + 23" }],
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high"
}
```

Thinking responses can include `message.reasoning_content` beside `message.content`.

## FIM Completion

Endpoint:

```http
POST https://api.deepseek.com/beta/completions
```

Minimal request:

```json
{
  "model": "deepseek-v4-pro",
  "prompt": "const answer = ",
  "suffix": ";",
  "max_tokens": 32
}
```

## Supported MCP Tools

- `chat_completion`
- `completion`
- `list_models`
- `get_user_balance`
- `reset_conversation`
- `list_conversations`
