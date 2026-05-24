import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // noworry-home-site is a separate git repo nested under the app for
  // convenience. It has its own deploy pipeline and its own (lighter)
  // lint posture; the app's React/browser ESLint env shouldn't be
  // recursing into its api/ Node functions or static HTML/JS.
  globalIgnores(['dist', 'noworry-home-site']),
  {
    // Client app — React + Vite. .mjs extension intentionally excluded so
    // server-side .mjs files don't get hit with React-Compiler rules.
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Server-side: Vercel serverless functions + Node scripts. No React
    // rules. Node globals (process, console, Buffer …).
    files: ['api/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
])
