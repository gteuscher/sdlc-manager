import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

/**
 * Gate 2 of the verify command (constitution, Development Workflow).
 *
 * Three rules here are load-bearing rather than stylistic:
 *
 *   T006 — the layer boundary. `src/core` and `src/providers` may not import
 *          Electron, React, or anything under `src/renderer`. plan.md calls this
 *          the machine-checked form of the boundary that the process split
 *          already enforces at runtime; the lint rule catches it at build time,
 *          before the process split can be relied on.
 *
 *   T007 — lifecycle vocabulary. No state, gate, transition, or provider name may
 *          appear as a string literal inside the engine or the renderer
 *          (Principle II). A lifecycle is data; code that names one state has
 *          stopped being generic over lifecycles.
 *
 *   T005 — jsx-a11y, which is Principle XI's machine-verifiable subset.
 */

/** Vocabulary that, appearing as a literal in engine or UI code, means a lifecycle got hardcoded. */
const LIFECYCLE_VOCABULARY =
  '^(jira|github|github-checks|checks|filesystem|tracker|' +
  'spec|specification|build|implementation|release|released|review|reviewing|' +
  'brainstorm|sprints|backlog|todo|in progress|in refinement|ready for release|' +
  'qa|deploy|deployed|done|approved)$';

export default tseslint.config(
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'tmp/**', 'coverage/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The constitution permits `any` only with a justification in the commit
      // message, so it is an error here rather than a warning.
      '@typescript-eslint/no-explicit-any': 'error',
      // Principle VIII: no import-time side effects.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program > ExpressionStatement > CallExpression',
          message:
            'Import-time side effects are prohibited (Principle VIII). Export a function and let a composition root call it.',
        },
      ],
      eqeqeq: ['error', 'smart'],
    },
  },

  // ── T006: the layer boundary ────────────────────────────────────────────────
  {
    files: ['src/core/**/*.ts', 'src/providers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                'src/core and src/providers run in the main process as plain TypeScript. Importing Electron here breaks Principle IV (unit-testable without a runtime).',
            },
            {
              name: 'react',
              message:
                'The engine must not depend on the UI (Principle IV). React is not available in this layer.',
            },
            {
              name: 'react-dom',
              message: 'The engine must not depend on the UI (Principle IV).',
            },
          ],
          patterns: [
            {
              group: ['@renderer/*', '**/renderer/*', '../renderer/*'],
              message:
                'src/core and src/providers must not import renderer code. The dependency runs one way only (plan.md, Structure Decision).',
            },
          ],
        },
      ],
    },
  },

  // ── T007: no lifecycle vocabulary in the engine or the UI ───────────────────
  {
    files: ['src/core/engine/**/*.ts', 'src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program > ExpressionStatement > CallExpression',
          message:
            'Import-time side effects are prohibited (Principle VIII). Export a function and let a composition root call it.',
        },
        {
          selector: `Literal[value=/${LIFECYCLE_VOCABULARY}/i]`,
          message:
            'Lifecycle vocabulary — a state, gate, transition, or provider name — must not appear as a literal here (Principle II). Read it from the loaded SDLC definition instead.',
        },
      ],
    },
  },

  // Process entry points. A preload script and the Electron main entry exist in
  // order to run on load — the side effect is the contract, not hidden coupling.
  // Nothing else in src/ gets this exemption.
  {
    files: ['src/preload/index.ts', 'src/main/entry.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // ── T005: accessibility is a correctness property (Principle XI) ────────────
  {
    files: ['src/renderer/**/*.tsx', 'tests/component/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      // Principle XI states this one explicitly.
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
    },
  },

  // Tests and build scripts describe lifecycles on purpose — an engine test that
  // could not invent a state name would be testing nothing. Scripts are also
  // entry points, where a top-level call is the point rather than hidden coupling.
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'scripts/**', '*.config.ts', 'eslint.config.js'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
