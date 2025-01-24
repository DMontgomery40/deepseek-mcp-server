# DeepSeek MCP Server

A Model Context Protocol (MCP) server for the DeepSeek API, allowing seamless integration of DeepSeek's powerful language models with MCP-compatible applications like Claude Desktop.

<a href="https://glama.ai/mcp/servers/asht4rqltn"><img width="380" height="200" src="https://glama.ai/mcp/servers/asht4rqltn/badge" alt="DeepSeek Server MCP server" /></a>

## Installation

```bash
npm install -g deepseek-mcp-server
```

## Configuration

1. Get your DeepSeek API key from [DeepSeek Platform](https://platform.deepseek.com/api_keys)

2. Set up your environment:
   ```bash
   export DEEPSEEK_API_KEY=your-api-key
   ```
   Or create a `.env` file:
   ```
   DEEPSEEK_API_KEY=your-api-key
   ```

## Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "deepseek": {
      "command": "npx",
      "args": [
        "-y",
        "deepseek-mcp-server"
      ],
      "env": {
        "DEEPSEEK_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Features

- Chat completion tool with support for:
  - Custom model selection
  - Temperature control
  - Max tokens limit
  - Top P sampling
  - Presence penalty
  - Frequency penalty


## Testing with MCP Inspector

You can test the server locally using the MCP Inspector tool:

1. Build the server:
   ```bash
   npm run build
   ```

2. Run the server with MCP Inspector:
   ```bash
   # Make sure to specify the full path to the built server
   npx @modelcontextprotocol/inspector node ./build/index.js
   ```

The inspector will open in your browser and connect to the server via stdio transport. You can:
- View available tools
- Test chat completions with different parameters
- Debug server responses
- Monitor server performance

Note: The server uses DeepSeek's R1 model (deepseek-reasoner) by default, which provides state-of-the-art performance for reasoning and general tasks.

## License

MIT
