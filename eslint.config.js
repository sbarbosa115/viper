import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const api = 'apps/api/src/modules/*';
const sameModule = (type) => ({
  element: { type, captured: { module: '{{ from.element.captured.module }}' } },
});
const domainPortsIn = (types) => ({ element: { types } });
const external = { module: { origin: ['external', 'core'] } };

// Layer and module rules from architecture.md, section 2.
const boundaryPolicies = [
  // Third-party and Node built-ins are not governed here (domain purity is enforced below).
  { allow: { to: external } },
  // Tests may use the test helpers and fakes of their own app.
  { from: { file: { categories: 'test' } }, allow: { to: { module: { origin: 'local' } } } },
  { allow: { to: { element: { type: 'contracts' } } } },
  // Every element may use itself.
  {
    from: { element: { type: 'module-domain' } },
    allow: { to: [sameModule('module-domain'), domainPortsIn(['shared-domain'])] },
  },
  {
    from: { element: { type: 'module-application' } },
    allow: {
      to: [
        sameModule('module-application'),
        sameModule('module-domain'),
        domainPortsIn(['shared-domain', 'shared-application']),
      ],
    },
  },
  {
    from: { element: { type: 'module-infrastructure' } },
    allow: {
      to: [
        sameModule('module-infrastructure'),
        sameModule('module-application'),
        sameModule('module-domain'),
        domainPortsIn(['shared-domain', 'shared-application', 'shared-infrastructure']),
      ],
    },
  },
  {
    from: { element: { type: 'module-http' } },
    allow: {
      to: [
        sameModule('module-http'),
        sameModule('module-application'),
        sameModule('module-domain'),
        domainPortsIn(['shared-domain', 'shared-application', 'shared-http']),
      ],
    },
  },
  {
    from: { element: { type: 'module-test' } },
    allow: {
      to: [
        sameModule('module-test'),
        sameModule('module-application'),
        sameModule('module-domain'),
        sameModule('module-infrastructure'),
        sameModule('module-http'),
        sameModule('module-public'),
        domainPortsIn([
          'shared-domain',
          'shared-application',
          'shared-infrastructure',
          'shared-http',
        ]),
      ],
    },
  },
  {
    from: { element: { type: 'module-public' } },
    allow: {
      to: [
        sameModule('module-domain'),
        sameModule('module-application'),
        sameModule('module-infrastructure'),
        sameModule('module-http'),
        sameModule('module-public'),
        domainPortsIn([
          'shared-domain',
          'shared-application',
          'shared-infrastructure',
          'shared-http',
        ]),
      ],
    },
  },
  // Modules talk to each other only through another module's index.ts.
  {
    from: {
      element: {
        types: [
          'module-domain',
          'module-application',
          'module-infrastructure',
          'module-http',
          'module-public',
        ],
      },
    },
    allow: { to: { element: { type: 'module-public' } } },
  },
  // Shared kernel.
  { from: { element: { type: 'shared-domain' } }, allow: { to: domainPortsIn(['shared-domain']) } },
  {
    from: { element: { type: 'shared-application' } },
    allow: { to: domainPortsIn(['shared-domain', 'shared-application']) },
  },
  {
    from: { element: { type: 'shared-infrastructure' } },
    allow: { to: domainPortsIn(['shared-domain', 'shared-application', 'shared-infrastructure']) },
  },
  {
    from: { element: { type: 'shared-http' } },
    allow: { to: domainPortsIn(['shared-domain', 'shared-application', 'shared-http']) },
  },
  // Composition roots, scripts, migrations and test helpers wire everything together.
  {
    from: { element: { type: 'api-root' } },
    allow: {
      to: {
        element: {
          types: [
            'api-root',
            'shared-domain',
            'shared-application',
            'shared-infrastructure',
            'shared-http',
            'module-public',
            'module-infrastructure',
            'module-application',
            'module-domain',
            'module-http',
            'module-test',
          ],
        },
      },
    },
  },
  // Web: features never import another feature's internals.
  {
    from: { element: { type: 'web-feature' } },
    allow: {
      to: [
        {
          element: {
            type: 'web-feature',
            captured: { feature: '{{ from.element.captured.feature }}' },
          },
        },
        { element: { type: 'web-shared' } },
      ],
    },
  },
  { from: { element: { type: 'web-shared' } }, allow: { to: { element: { type: 'web-shared' } } } },
  {
    from: { element: { type: 'web-app' } },
    allow: { to: { element: { types: ['web-app', 'web-feature', 'web-shared'] } } },
  },
  {
    from: { element: { type: 'web-test' } },
    allow: {
      to: { element: { types: ['web-root', 'web-app', 'web-feature', 'web-shared', 'web-test'] } },
    },
  },
  {
    from: { element: { type: 'web-root' } },
    allow: { to: { element: { types: ['web-root', 'web-app', 'web-feature', 'web-shared'] } } },
  },
];

const purityMessage =
  'The domain and application layers are framework-free: no I/O libraries or process.env.';
const ioPackages = [
  'fastify',
  'fastify-*',
  '@fastify/*',
  'kysely',
  'mysql2',
  'mysql2/*',
  'bullmq',
  'ioredis',
  'pino',
  'zod',
  'nodemailer',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '.build/**',
      '.npm-cache/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'docs/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },
  {
    files: ['apps/api/**/*.ts', 'e2e/**/*.ts', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.flat.recommended.rules,
  },
  {
    files: ['**/*.test.{ts,tsx}', 'apps/api/test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  // Layer and module boundaries.
  {
    files: ['apps/api/**/*.ts', 'apps/web/src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          noWarnOnMultipleProjects: true,
          project: [
            'apps/api/tsconfig.json',
            'apps/web/tsconfig.json',
            'packages/contracts/tsconfig.json',
          ],
        },
      },
      'boundaries/files': [{ pattern: '**/*.test.{ts,tsx}', category: 'test' }],
      'boundaries/elements': [
        { type: 'contracts', pattern: 'packages/contracts' },
        { type: 'module-domain', pattern: `${api}/domain`, capture: ['module'] },
        { type: 'module-application', pattern: `${api}/application`, capture: ['module'] },
        { type: 'module-infrastructure', pattern: `${api}/infrastructure`, capture: ['module'] },
        { type: 'module-http', pattern: `${api}/http`, capture: ['module'] },
        { type: 'module-test', pattern: `${api}/test`, capture: ['module'] },
        {
          type: 'module-public',
          pattern: `${api}/index.ts`,
          partialMatch: false,
          capture: ['module'],
        },
        { type: 'shared-domain', pattern: 'apps/api/src/shared/domain' },
        { type: 'shared-application', pattern: 'apps/api/src/shared/application' },
        { type: 'shared-infrastructure', pattern: 'apps/api/src/shared/infrastructure' },
        { type: 'shared-http', pattern: 'apps/api/src/shared/http' },
        {
          type: 'api-root',
          pattern: [
            'apps/api/src/*.ts',
            'apps/api/src/{config,site,scripts}',
            'apps/api/migrations',
            'apps/api/test',
          ],
          partialMatch: false,
        },
        { type: 'web-feature', pattern: 'apps/web/src/features/*', capture: ['feature'] },
        { type: 'web-shared', pattern: 'apps/web/src/shared' },
        { type: 'web-app', pattern: 'apps/web/src/app' },
        { type: 'web-test', pattern: 'apps/web/src/test' },
        { type: 'web-root', pattern: 'apps/web/src/*.{ts,tsx}', partialMatch: false },
      ],
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', policies: boundaryPolicies }],
    },
  },
  {
    files: [
      'apps/api/src/modules/*/{domain,application}/**/*.ts',
      'apps/api/src/shared/{domain,application}/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ioPackages, message: purityMessage }] },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: purityMessage,
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Inject Clock instead of new Date().',
        },
      ],
    },
  },
  prettier,
);
