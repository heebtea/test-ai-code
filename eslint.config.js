import js from "@eslint/js";
import globals from "globals";
export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "tests/**/*.{js,cjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },
];
