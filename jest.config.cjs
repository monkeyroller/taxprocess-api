/**
 * Jest config (CommonJS — the package itself is ESM). Runs every colocated `*.test.ts` under `src`
 * — the provider layer's tests and the copied ARCA SDK's alike — via ts-jest's ESM preset. Uses
 * `isolatedModules` so tests exercise runtime behaviour (including the SDK's extraction regression
 * oracle) independently of the strict typecheck gate, which is `pnpm typecheck` (tsc).
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true,
      },
    ],
  },
};
