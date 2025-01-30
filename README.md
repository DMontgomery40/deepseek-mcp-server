# Smithery.ai

# deepseek-mcp-server

[![npm version](https://img.shields.io/npm/v/deepseek-mcp-server)](https://www.npmjs.com/package/deepseek-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/deepseek-mcp-server)](https://www.npmjs.com/package/deepseek-mcp-server)
[![GitHub issues](https://img.shields.io/github/issues/DMontgomery40/deepseek-mcp-server)](https://github.com/DMontgomery40/deepseek-mcp-server/issues)
[![GitHub forks](https://img.shields.io/github/forks/DMontgomery40/deepseek-mcp-server)](https://github.com/DMontgomery40/deepseek-mcp-server/network)
[![GitHub stars](https://img.shields.io/github/stars/DMontgomery40/deepseek-mcp-server)](https://github.com/DMontgomery40/deepseek-mcp-server/stargazers)
[![GitHub license](https://img.shields.io/github/license/DMontgomery40/deepseek-mcp-server?color=blue)](https://github.com/DMontgomery40/deepseek-mcp-server/blob/main/LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/DMontgomery40/deepseek-mcp-server/ci.yml?branch=main)](https://github.com/DMontgomery40/deepseek-mcp-server/actions)
(https://codecov.io/gh/DMontgomery40/deepseek-mcp-server)
[![Codacy Badge](https://api.codacy.com/project/badge/Grade/YOUR_CODACY_PROJECT_ID)](https://www.codacy.com/gh/DMontgomery40/deepseek-mcp-server/dashboard)
[![Code Climate Maintainability](https://img.shields.io/codeclimate/maintainability/DMontgomery40/deepseek-mcp-server)](https://codeclimate.com/github/DMontgomery40/deepseek-mcp-server)
[![Bundlephobia minzip](https://img.shields.io/bundlephobia/minzip/deepseek-mcp-server)](https://bundlephobia.com/result?p=deepseek-mcp-server)
[![GitHub last commit](https://img.shields.io/github/last-commit/DMontgomery40/deepseek-mcp-server)](https://github.com/DMontgomery40/deepseek-mcp-server/commits/main)
[![Node version](https://img.shields.io/node/v/deepseek-mcp-server)](https://www.npmjs.com/package/deepseek-mcp-server)
[![Contributors](https://img.shields.io/github/contributors/DMontgomery40/deepseek-mcp-server)](https://github.com/DMontgomery40/deepseek-mcp-server/graphs/contributors)

A short description of your project…

## Installation

\`\`\`bash
echo "Install via npm" && npm install deepseek-mcp-server
\`\`\`

## Usage

...



A short description of your project goes here. Enjoy all those badges!

## Getting Started

...



# DeepSeek MCP Server

A Model Context Protocol (MCP) server for the DeepSeek API, allowing seamless integration of DeepSeek's powerful language models with MCP-compatible applications like Claude Desktop.

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


## Local Testing

To test locally without Claude Desktop:

1. Clone and build the project:
   ```bash
   git clone https://github.com/DMontgomery40/deepseek-mcp-server.git
   cd deepseek-mcp-server
   npm install
   npm run build
   ```

2. Create a `.env` file with your API key:
   ```
   DEEPSEEK_API_KEY=your-api-key
   ```

3. Run the server:
   ```bash
   node build/index.js
   ```

4. In another terminal, use the MCP Inspector to test:
   ```bash
   npx @modelcontextprotocol/inspector connect --command "node" --args "build/index.js"
   ```

   This will open an interactive session where you can:
   - List available tools with `/tools`
   - Try the chat completion with `/call chat-completion {"messages": [{"role": "user", "content": "Hello!"}]}`
   - View configuration with `/read model-config://main`

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
