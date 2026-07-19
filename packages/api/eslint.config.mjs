import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: ["dist/**", ".wrangler/**"]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json"
      },
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
  {
    // test/ is intentionally NOT covered by tsconfig.json's `include`
    // (that project ships only @cloudflare/workers-types, and the tests here
    // import node:fs — see the header comment in wrangler-prod-env.test.ts).
    // So we cannot attach `parserOptions.project` for test/ without breaking
    // typed parsing. Instead we apply the same TS parser + recommended rules
    // WITHOUT a project reference: this lints test/ for real (syntax + the
    // non-type-aware recommended rules) rather than silently excluding it.
    files: ["test/**/*.ts"],
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
