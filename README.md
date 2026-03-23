# Flyff Node.js Server Emulator

This is a modern **Flyff (Fly For Fun) MMORPG server emulator** written in TypeScript/Node.js. It replicates the Login, Cluster, and World servers of the game and communicates with real Flyff game clients over TCP using the authentic binary packet protocol.

## Features
- **Modern Stack**: Node.js 20 LTS, pure ESM, strict TypeScript.
- **Monorepo Architecture**: Managed by `pnpm` workspaces for clear separation of concerns.
- **Multi-Server Topology**: Independent Login, Cluster, and World servers communicating via signed Redis Pub/Sub IPC.
- **Clean Architecture**: Strict separation of Handlers, Services, and Repositories.
- **Multi-Database Support**: Knex.js query builder with support for PostgreSQL, MySQL, and SQLite3.

## Project Structure
```text
packages/
  core/               # Shared constants, packet protocol, utils, IPC
  login-server/       # Authentication and server list (port 23000)
  cluster-server/     # Character selection and creation (port 38100)
  world-server/       # Core gameplay loop and game systems (port 38180)
  database/           # Repositories, DB connection pool, migrations
resources/            # Loaders, parsers, and game data (propItem, propMover, etc.)
```

## Requirements
- **Node.js**: v20.x (LTS) or higher
- **Package Manager**: `pnpm`
- **Database**: PostgreSQL / MySQL / SQLite3 (for local dev)
- **Cache / IPC**: Redis

## Getting Started

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Setup environment variables:**
   Copy `.env.example` to `.env` and configure your database and Redis connections.

3. **Run database migrations:**
   ```bash
   pnpm --filter @flyff/database run migrate
   ```

4. **Start the servers:**
   ```bash
   # In separate terminal windows:
   pnpm --filter @flyff/login-server run dev
   pnpm --filter @flyff/cluster-server run dev
   pnpm --filter @flyff/world-server run dev
   ```

## Development
- **Testing**: `pnpm test` (Uses native Node.js `--test` runner via `tsx`)
- **Linting**: `pnpm lint` (ESLint)
- **Building**: `pnpm build` (tsc)

## License
This project is licensed under the **AGPL-3.0 License**. See the `LICENSE` file for details.
