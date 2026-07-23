# Test Organization Rules

These rules enforce the separation of test files from source code.

## Cardinal Rule

**NEVER create `.test.ts` files in `src/` directories.**

All test files MUST be created in `test/` directories at the package level.

## Directory Structure

Each package must follow this structure:

```
packages/<package-name>/
  src/              ← Source code only (.ts files)
    handlers/
    services/
    repositories/
    utils/
  test/             ← Tests only (.test.ts files)
    handlers/
    services/
    repositories/
    utils/
    mocks.ts        ← Test utilities
  dist/             ← Compiled output (gitignored)
```

## Test File Creation Workflow

When creating a new test file:

1. **Identify the source file path:**
   ```
   src/handlers/auth.handler.ts
   ```

2. **Create the corresponding test path:**
   ```
   test/handlers/auth.handler.test.ts
   ```

3. **Create the directory if it doesn't exist:**
   ```bash
   mkdir -p test/handlers
   ```

4. **Write the test with correct imports:**
   ```ts
   // test/handlers/auth.handler.test.ts
   import { authHandler } from '../../src/handlers/auth.handler';
   //                    ^^^^^^^^^^^^^^^^
   //                    Import from src/, not ./
   ```

## Import Path Patterns

Tests must use relative imports to `src/`:

```
test/net/PacketWriter.test.ts     → import from ../../src/net/PacketWriter
test/cache/MemoryCache.test.ts    → import from ../../src/cache/MemoryCache
test/handlers/auth.handler.test.ts → import from ../../src/handlers/auth.handler
test/utils/math.test.ts          → import from ../../src/utils/math
```

## Anti-Patterns (FORBIDDEN)

❌ **NEVER do this:**
```ts
// src/net/PacketWriter.test.ts  ← WRONG! Tests in src/
import { PacketWriter } from './PacketWriter';  ← WRONG! Relative import
```

✅ **ALWAYS do this:**
```ts
// test/net/PacketWriter.test.ts  ← CORRECT! Tests in test/
import { PacketWriter } from '../../src/net/PacketWriter';  ← CORRECT! Import from src/
```

## Enforcement

The following mechanisms enforce this rule:

1. **Pre-commit hooks** will reject `src/**/*.test.ts` files
2. **ESLint rules** flag co-located test files
3. **CI/CD pipelines** will fail if tests are found in `src/`
4. **Agent instructions** explicitly forbid creating tests in `src/`

## Migration Checklist

When moving legacy tests to `test/`:

- [ ] Move `.test.ts` file from `src/` to `test/` (preserve directory structure)
- [ ] Update imports: `./File.js` → `../../src/path/File.js`
- [ ] Update `package.json`: `test/**/*.test.ts` (not `src/**/*.test.ts`)
- [ ] Verify tests still pass after migration
- [ ] Delete old test file from `src/`

## Examples

### Handler Test
```
src/handlers/login.handler.ts  →  test/handlers/login.handler.test.ts
```

### Service Test
```
src/services/auth.service.ts   →  test/services/auth.service.test.ts
```

### Repository Test
```
src/repositories/account.repo.ts  →  test/repositories/account.repo.test.ts
```

### Utility Test
```
src/utils/math.ts              →  test/utils/math.test.ts
```

## Package.json Test Scripts

All packages must use:

```json
{
  "scripts": {
    "test": "tsx --test test/**/*.test.ts"
  }
}
```

Root package.json must use:

```json
{
  "scripts": {
    "test": "tsx --test packages/*/test/**/*.test.ts",
    "test:core": "tsx --test packages/core/test/**/*.test.ts"
  }
}
```

## Rationale

Separating tests from source code provides:

1. **Clean source directories** — Only production code in `src/`
2. **Faster builds** — Test files not bundled in production
3. **Clear separation** — Easy to distinguish source from tests
4. **Better tooling** — Test runners can ignore `src/`
5. **Deployment safety** — No accidental test code deployment
