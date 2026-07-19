import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";

// Mirrors packages/api/eslint.config.mjs: same major versions (ESLint 9 flat
// config, @typescript-eslint 8, @eslint/js 9, eslint-config-prettier 10) and
// the same rule set (js.recommended + tsPlugin.recommended + prettier).
//
// Difference vs. api: no `parserOptions.project`. `npm run lint` here is
// `eslint src --ext .ts`, which also lints the co-located `*.test.ts` files —
// but tsconfig.json EXCLUDES `src/**/*.test.ts`, so attaching a project would
// make typed parsing fail on the test files. The recommended (non
// type-checked) rules don't need type info, so we parse TS syntax without a
// project and lint source + tests uniformly.
export default [
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      globals: {
        console: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-undef": "off",
      "no-console": "off"
    }
  },
  eslintConfigPrettier
];
