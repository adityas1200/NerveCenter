import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import boundaries from "eslint-plugin-boundaries";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**", ".husky/**", "legacy-static/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts", "vite.config.ts", "playwright.config.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        project: ["./tsconfig.json", "./tsconfig.node.json"],
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      boundaries,
      react: reactPlugin,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      import: importPlugin,
      "react-refresh": reactRefresh,
    },
    settings: {
      react: { version: "detect" },
      "boundaries/elements": [
        { type: "app", pattern: "src/App.tsx" },
        { type: "api", pattern: "src/api/**" },
        { type: "components", pattern: "src/components/**" },
        { type: "data", pattern: "src/data/**" },
        { type: "features", pattern: "src/features/**" },
        { type: "store", pattern: "src/store/**" },
        { type: "lib", pattern: "src/lib/**" },
        { type: "test", pattern: "src/test/**" },
        { type: "types", pattern: "src/types/**" },
      ],
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,

      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],

      "react/prop-types": "off",
      "react/no-unknown-property": ["error", { ignore: ["jsx"] }],
      "no-unused-vars": "off",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "react/jsx-no-target-blank": [
        "error",
        { allowReferrer: false, enforceDynamicLinks: "always" },
      ],
      "react/no-danger": "warn",
      "import/no-duplicates": "error",
      "import/no-self-import": "error",
      "boundaries/element-types": ["error", { default: "allow" }],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/label-has-associated-control": "warn",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "src/test/**"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["scripts/**/*.{mjs,mts}", "*.config.js", "eslint.config.js"],
    languageOptions: {
      sourceType: "module",
      parser: tsParser,
      globals: {
        ...globals.node,
      },
    },
  },
];
