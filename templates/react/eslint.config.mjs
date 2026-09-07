// Flat ESLint config — executable form of
//   .cursor/rules/03-react-architecture-guard.mdc
//   .cursor/rules/04-security-guard.mdc
//   .cursor/rules/08-rtl-i18n-guard.mdc
//
// Everything below is `"error"` on purpose. A warning is a rule you have decided
// to break later; these are the ones you have decided not to break.
//
// Install:
//   npm i -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks \
//            eslint-plugin-jsx-a11y eslint-plugin-import eslint-plugin-react-refresh
//
// Optional but recommended for RTL in stylesheets (this config only covers
// inline styles and className strings):
//   npm i -D stylelint stylelint-config-standard @csstools/stylelint-use-logical

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist/**", "build/**", ".next/**", "coverage/**", "node_modules/**", "**/*.generated.ts"] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      import: importPlugin,
      "react-refresh": reactRefresh,
    },
    settings: {
      "import/resolver": { typescript: true, node: true },
    },
    rules: {
      // ===================================================================
      //  03-react-architecture-guard — layering
      // ===================================================================

      // No feature may reach into another feature's internals. Cross-feature
      // communication goes through each feature's public index.ts.
      "import/no-restricted-paths": ["error", {
        zones: [
          {
            target: "./src/features/*/!(index.ts)",
            from: "./src/features",
            except: ["./index.ts"],
            message:
              "Cross-feature import of an internal module. Import from the feature's public index.ts instead. (.cursor/rules/03)",
          },
          {
            target: "./src/components",
            from: "./src/features",
            message:
              "Shared components must not depend on features — that inverts the dependency. Lift the shared part out. (.cursor/rules/03)",
          },
          {
            target: "./src/api",
            from: "./src/features",
            message: "The API layer is a leaf. It must not import feature code. (.cursor/rules/03)",
          },
        ],
      }],

      "import/no-cycle": ["error", { maxDepth: 4, ignoreExternal: true }],
      "import/no-default-export": "off",

      "no-restricted-imports": ["error", {
        paths: [
          { name: "axios", message: "Import the configured client from src/api/client instead of raw axios. (.cursor/rules/03)" },
          { name: "moment", message: "moment is in maintenance mode. Use date-fns or Temporal." },
          { name: "lodash", message: "Import the single function: lodash/debounce. The barrel import ships the whole library." },
        ],
        patterns: [
          { group: ["../../../*"], message: "Deep relative import — use a path alias (@/...)." },
          { group: ["**/features/*/components/*", "**/features/*/hooks/*", "**/features/*/api/*"],
            message: "Reaching into a feature's internals. Import from its index.ts. (.cursor/rules/03)" },
        ],
      }],

      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // ===================================================================
      //  04-security-guard
      // ===================================================================
      "no-restricted-properties": ["error",
        { object: "localStorage",   property: "setItem", message: "Never store auth tokens in web storage — XSS reads them. Use an HttpOnly cookie. If this is a non-sensitive UI preference, disable this rule inline with a justification. (.cursor/rules/04)" },
        { object: "sessionStorage", property: "setItem", message: "Never store auth tokens in web storage. (.cursor/rules/04)" },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      // ===================================================================
      //  08-rtl-i18n-guard + 04 — AST-level bans
      // ===================================================================
      "no-restricted-syntax": ["error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML requires sanitisation (DOMPurify). Prefer rendering text. (.cursor/rules/04)",
        },
        {
          selector: "Property[key.name=/^(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight|left|right)$/]",
          message: "Physical CSS property breaks RTL. Use the logical equivalent: marginInlineStart/End, paddingInlineStart/End, insetInlineStart/End. (.cursor/rules/08)",
        },
        {
          selector: "Property[key.name='textAlign'][value.value=/^(left|right)$/]",
          message: "textAlign: 'left'/'right' breaks RTL. Use 'start'/'end'. (.cursor/rules/08)",
        },
        {
          selector: "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/][arguments.length=0]",
          message: "Locale-less formatting renders Latin digits in an Arabic UI. Pass an explicit locale. (.cursor/rules/08)",
        },
        {
          selector: "NewExpression[callee.object.name='Intl'][arguments.length=0]",
          message: "Intl formatter without an explicit locale. Pass the active locale. (.cursor/rules/08)",
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Read config from a typed config module, not process.env scattered through components.",
        },
      ],

      // ===================================================================
      //  Accessibility
      // ===================================================================
      ...jsxA11y.flatConfigs.recommended.rules,
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/label-has-associated-control": "error",

      // Correctness
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // =====================================================================
  //  Components: no direct data fetching. This is rule 03's headline rule.
  // =====================================================================
  {
    files: ["src/**/components/**/*.{ts,tsx}", "src/**/pages/**/*.tsx", "src/**/routes/**/*.tsx"],
    rules: {
      "no-restricted-globals": ["error",
        { name: "fetch", message: "No fetch in components. Call a hook from the API layer (React Query). (.cursor/rules/03)" },
      ],
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["axios", "**/axios"], message: "No HTTP client in components — go through the API layer. (.cursor/rules/03)" },
          { group: ["**/infrastructure/**", "**/db/**"], message: "Components must not import data-access modules. (.cursor/rules/03)" },
        ],
      }],
      "max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 120, skipBlankLines: true, skipComments: true }],
      complexity: ["error", 12],
    },
  },

  // The API layer is the one place allowed to speak HTTP.
  {
    files: ["src/api/**/*.ts", "src/**/api/**/*.ts", "src/lib/http/**/*.ts"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-imports": "off",
    },
  },

  // Tests
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "**/__tests__/**", "e2e/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "no-console": "off",
      "max-lines": "off",
      "no-restricted-syntax": "off",
    },
  },
);
