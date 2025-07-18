#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { Command } from 'commander';
import { z } from 'zod';
import { AuthConfig } from './utils/auth.js';
import { EPortalClient } from './utils/api-client.js';
import { registerServerTools, handleServerTool } from './tools/servers.js';
import { registerFeedTools, handleFeedTool } from './tools/feeds.js';
import { registerKeyTools, handleKeyTool } from './tools/keys.js';
import { registerPatchsetTools, handlePatchsetTool } from './tools/patchsets.js';
import { registerUserTools, handleUserTool } from './tools/users.js';

const ConfigSchema = z.object({
  eportal_url: z.string().url(),
  auth: z.object({
    type: z.enum(['basic', 'api_key']),
    username: z.string().optional(),
    password: z.string().optional(),
    api_key: z.string().optional(),
    header_name: z.string().optional()
  })
});

type Config = z.infer<typeof ConfigSchema>;

class TuxCareEPortalMCP {
  private server: Server;
  private client: EPortalClient;
  private tools: Map<string, Tool> = new Map();

  constructor(config: Config) {
    this.server = new Server(
      {
        name: 'tuxcare-eportal-mcp',
        version: '1.0.5'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    const authConfig: AuthConfig = {
      type: config.auth.type,
      username: config.auth.username,
      password: config.auth.password,
      apiKey: config.auth.api_key,
      headerName: config.auth.header_name
    };

    this.client = new EPortalClient(config.eportal_url, authConfig);
    this.setupHandlers();
    this.registerTools();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.tools.values())
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        // Route to appropriate tool handler based on tool name
        if (['list_servers', 'register_host', 'unregister_host', 'bulk_unregister_hosts', 'set_server_tags'].includes(name)) {
          return await handleServerTool(name, args, this.client);
        } else if (['list_feeds', 'create_feed', 'delete_feed'].includes(name)) {
          return await handleFeedTool(name, args, this.client);
        } else if (['list_keys', 'create_key', 'delete_key'].includes(name)) {
          return await handleKeyTool(name, args, this.client);
        } else if (['list_patchsets', 'manage_patchsets'].includes(name)) {
          return await handlePatchsetTool(name, args, this.client);
        } else if (['list_users'].includes(name)) {
          return await handleUserTool(name, args, this.client);
        } else {
          throw new Error(`Tool ${name} not found`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text', text: `Error executing tool ${name}: ${errorMessage}` }],
          isError: true
        };
      }
    });
  }

  private registerTools() {
    registerServerTools(this.tools);
    registerFeedTools(this.tools);
    registerKeyTools(this.tools);
    registerPatchsetTools(this.tools);
    registerUserTools(this.tools);
  }

  async start() {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
    } catch (error) {
      console.error('Error starting MCP server:', error);
      throw error;
    }
  }
}

async function main() {
  const program = new Command();
  
  program
    .name('tuxcare-eportal-mcp')
    .description('TuxCare ePortal MCP server for ePortal API integration')
    .version('1.0.5')
    .option('-c, --config <path>', 'Path to config file')
    .option('-u, --url <url>', 'ePortal URL')
    .option('-a, --auth-type <type>', 'Authentication type (basic|api_key)', 'basic')
    .option('--username <username>', 'Username for basic auth')
    .option('--password <password>', 'Password for basic auth')
    .option('--api-key <key>', 'API key for api_key auth')
    .option('--header-name <name>', 'Custom header name for API key')
    .parse();

  const options = program.opts();

  let config: Config;

  // Try to load config file if provided, otherwise use command line options or environment variables
  if (options.config) {
    try {
      const fs = await import('fs');
      const configFile = fs.readFileSync(options.config, 'utf8');
      config = ConfigSchema.parse(JSON.parse(configFile));
    } catch (error) {
      console.error('Error loading config file:', error);
      process.exit(1);
    }
  } else {
    // Build config from command line options or environment variables
    const url = options.url || process.env.TUXCARE_EPORTAL_URL;
    const authType = options.authType || process.env.TUXCARE_AUTH_TYPE || 'basic';
    
    if (!url) {
      console.error('ePortal URL is required. Use --url, provide a config file, or set TUXCARE_EPORTAL_URL environment variable.');
      process.exit(1);
    }

    const authConfig: any = { type: authType };
    
    if (authType === 'basic') {
      const username = options.username || process.env.TUXCARE_USERNAME;
      const password = options.password || process.env.TUXCARE_PASSWORD;
      
      if (!username || !password) {
        console.error('Username and password are required for basic auth. Use --username/--password or TUXCARE_USERNAME/TUXCARE_PASSWORD environment variables.');
        process.exit(1);
      }
      authConfig.username = username;
      authConfig.password = password;
    } else if (authType === 'api_key') {
      const apiKey = options.apiKey || process.env.TUXCARE_API_KEY;
      const headerName = options.headerName || process.env.TUXCARE_HEADER_NAME;
      
      if (!apiKey) {
        console.error('API key is required for api_key auth. Use --api-key or TUXCARE_API_KEY environment variable.');
        process.exit(1);
      }
      authConfig.api_key = apiKey;
      authConfig.header_name = headerName;
    }

    config = {
      eportal_url: url,
      auth: authConfig
    };
  }

  try {
    console.error('Starting TuxCare ePortal MCP server...');
    const server = new TuxCareEPortalMCP(config);
    console.error('Server created, starting connection...');
    await server.start();
    console.error('Server started successfully');
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Debug: Check if module is loading
console.error('TuxCare ePortal MCP module loaded');

// Always run main for MCP server
main().catch((error) => {
  console.error('Fatal error in main:', error);
  process.exit(1);
});

export { TuxCareEPortalMCP, ConfigSchema };