/**
 * Jest config (CommonJS — the package itself is ESM). Runs the copied ARCA SDK's colocated
 * `*.test.ts` unit tests under ts-jest's ESM preset. Uses `isolatedModules` so tests exercise
 * runtime behaviour (the extraction regression oracle) independently of the strict typecheck gate,
 * which is `pnpm typecheck` (tsc).
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
