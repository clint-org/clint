// @ts-check
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = tseslint.config(
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: ["element", "attribute"],
          prefix: "app",
          style: "kebab-case",
        },
      ],
      // Ratcheted to error after backlog cleared
      "@angular-eslint/prefer-standalone": "error",
      "@angular-eslint/no-input-rename": "error",
      "@angular-eslint/no-output-rename": "error",
      "@angular-eslint/no-output-on-prefix": "error",
      "@angular-eslint/contextual-decorator": "error",
      "@angular-eslint/relative-url-prefix": "error",
      "@angular-eslint/runtime-localize": "error",
      "@angular-eslint/use-injectable-provided-in": "error",
      // Still warn pending cleanup of the migration backlog
      "@angular-eslint/prefer-on-push-component-change-detection": "warn",
      "@angular-eslint/prefer-signals": "warn",
      "@angular-eslint/prefer-output-readonly": "warn",
      // New v21 rules; warn for now, ratchet as the backlog clears.
      // no-uncalled-signals requires typed linting (parserOptions.project);
      // revisit once typed linting is enabled workspace-wide.
      "@angular-eslint/prefer-inject": "warn",
      "@angular-eslint/prefer-output-emitter-ref": "warn",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      // Ratcheted to error after backlog cleared
      "@angular-eslint/template/prefer-control-flow": "error",
      "@angular-eslint/template/prefer-self-closing-tags": "error",
      "@angular-eslint/template/no-negated-async": "error",
      "@angular-eslint/template/prefer-ngsrc": "error",
      "@angular-eslint/template/no-any": "error",
      "@angular-eslint/template/no-duplicate-attributes": "error",
      "@angular-eslint/template/prefer-contextual-for-variables": "error",
      // Still warn pending cleanup of the migration backlog
      "@angular-eslint/template/no-call-expression": "warn",
      "@angular-eslint/template/no-inline-styles": "warn",
      // New v21 rules; warn for now, ratchet as the backlog clears
      "@angular-eslint/template/prefer-at-empty": "warn",
    },
  }
);
