# Aurora-4X-MCP

MCP (Model Context Protocol) server for Aurora 4X, providing integration capabilities with the Aurora 4X game.

## Overview

Aurora-4X-MCP is a Model Context Protocol server implementation that enables integration with Aurora 4X, a complex 4X space strategy game. This server provides tools and resources for interacting with Aurora 4X game data and functionality.

## Features

- SQLite database integration for game data management
- MCP protocol implementation using the official SDK
- Environment variable configuration support
- TypeScript-based implementation for type safety

## Prerequisites

- Node.js 22+ (required for built-in `node:sqlite` module)
- npm or yarn package manager
- Aurora 4X game installation
- TypeScript knowledge for development

## Installation

1. Clone the repository:

```bash
git clone https://github.com/Brennall/aurora-4x-mcp.git
cd aurora-4x-mcp
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory with your configuration:

```env
AURORA_DB_PATH=C:\Aurora\AuroraDB.db
```

## MCP Client Configuration

To connect your MCP client to this server, you'll need to configure it properly. Create or modify your MCP client configuration file (typically located at `~/.cursor/mcp.json` or equivalent based on your system):

```json
{
  "mcpServers": {
    "aurora-4x-mcp": {
      "command": "npm",
      "args": ["--prefix", "/path/to/aurora-4x-mcp", "start"],
      "cwd": "/path/to/aurora-4x-mcp"
    }
  }
}
```

Replace `/path/to/aurora-4x-mcp` with the actual path where you installed the server.

## Usage

### Development

To run the server in development mode with watch mode:

```bash
npm run dev
```

### Production

To build and run the server in production:

```bash
npm run build
npm start
```

### Available Scripts

- `npm start` - Build and start the server
- `npm run dev` - Run in development mode with watch
- `npm run build` - Build the TypeScript code
- `npm run lint` - Run ESLint for code quality

## Project Structure

```
aurora-4x-mcp/
├── src/
│   ├── app.ts          # Main application entry point
│   ├── db/             # Database related code (node:sqlite wrapper)
│   ├── tools/          # MCP tools implementation
│   └── resources/      # MCP resources implementation
├── dist/               # Compiled JavaScript output
├── data/               # Data storage
├── llms.txt            # AI-friendly tool documentation
└── node_modules/       # Dependencies
```

## AI Documentation

This project includes an [`llms.txt`](llms.txt) file following the [llms.txt specification](https://llmstxt.org/). It provides a complete tool catalogue with parameter descriptions, output schemas, safety constraints, and usage notes — optimised for LLM consumption.

**Want your AI assistant to understand this MCP server?** Point it at the raw file:

```
Fetch https://raw.githubusercontent.com/Brennall/aurora-4x-mcp/main/llms.txt and read the Aurora 4X MCP documentation
```

This gives the AI everything it needs to use the tools correctly — what each tool returns, what the parameters mean, and what safety filters are built in — without parsing source code or discovering output shapes by trial and error.

## Dependencies

### Main Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `node:sqlite` - Node.js built-in SQLite module (Node 22+, no external package required)
- `dotenv` - Environment configuration

### Development Dependencies

- `typescript` - TypeScript compiler
- `eslint` - Code linting
- Various TypeScript and ESLint plugins

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [thirionlogan/Aurora-4X-MCP](https://github.com/thirionlogan/Aurora-4X-MCP) - Original project
- Aurora 4X game developers
- Model Context Protocol team

## Support

For support, please open an issue in the GitHub repository.
