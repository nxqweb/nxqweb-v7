import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // NXQ intentionally loads remote Supabase data from mount effects. The
      // current React Hooks compiler-oriented rules flag that established
      // async loading pattern even though the state updates occur after I/O.
      // Keep exhaustive-deps enabled so dependency mistakes are still caught.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  {
    files: ['src/pages/ClientPortal.tsx'],
    rules: {
      // ClientPortal owns one legacy, mount-only aggregate loader that is also
      // invoked explicitly after guarded mutations. Adding the non-memoized
      // loader to the mount effect dependencies would create repeated reloads.
      // Keep this exception isolated to that file while exhaustive-deps stays
      // enabled everywhere else.
      'react-hooks/exhaustive-deps': 'off',
    },
  },
])
