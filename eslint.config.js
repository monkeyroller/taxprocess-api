// Flat ESLint config (ESM). Strict, type-checked linting for NEW code only — the copied ARCA SDK under
// `src/providers/arca/sdk` is ignored (it travels as-is and is validated by its own unit tests + tsc).
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// No re-export barrels: import from the module that defines the symbol. A barrel import is the coarsest
// possible dependency edge ('depend on all of it'), which is how accidental cycles and whole-subtree eager
// loading get in. Ignored dirs (the copied SDK, tests) are out of scope.
const NO_BARREL_IMPORTS = {
  group: ['**/index.js'],
  message: 'Import from the defining module, not a re-export barrel.',
};

// Provider-owned shared vocabularies must not reach into `http/dto`, directly or transitively. `http/dto/*`
// imports THESE (see `taxpayer-result.dto.ts`, `currency-rates-result.dto.ts`) and
// `provider/neutral-results.ts` imports those DTOs back, so a path from here into `http/**` closes a cycle
// through decorated DTO classes — real ESM value imports, which in a cycle evaluate against a
// half-initialized module rather than merely tripping a linter.
const NO_HTTP_FROM_PROVIDER_VOCABULARY = {
  group: ['**/http/**'],
  message:
    'A provider-owned vocabulary must not import from http/dto — http/dto imports it, and the reverse edge closes a cycle.',
};

/**
 * `no-restricted-imports` configured with `patterns`. Flat config REPLACES a rule's options rather than
 * merging them, so an override that names only its own pattern silently drops every pattern the base config
 * set — which is how the barrel ban went missing on the five vocabulary files below. Every configuration of
 * this rule therefore goes through here and states its patterns in full.
 */
const restrictedImports = (...patterns) => ['error', { patterns }];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.claude/**', // transient agent worktrees / scratch — never lint
      'scripts/**', // build-time codegen, outside tsconfig's `src` — run by hand, never shipped
      'src/providers/arca/sdk/**',
      '**/*.test.ts',
      '*.config.js',
      '*.config.cjs',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Strong-typing house rules (align with CLAUDE.md).
      '@typescript-eslint/no-restricted-imports': restrictedImports(NO_BARREL_IMPORTS),
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'generic' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  prettier,
  {
    // The provider-owned vocabularies `http/dto` imports. `neutral-results.ts` is deliberately NOT here:
    // importing the result DTOs type-only is its whole job.
    files: [
      'src/providers/provider/rate-band/**/*.ts',
      'src/providers/provider/taxpayer-vocabulary/**/*.ts',
      'src/providers/provider/address-code-scheme/**/*.ts',
      'src/providers/provider/environment.ts',
      'src/providers/provider/neutral-invoice.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': restrictedImports(
        NO_BARREL_IMPORTS,
        NO_HTTP_FROM_PROVIDER_VOCABULARY,
      ),
    },
  },
);
