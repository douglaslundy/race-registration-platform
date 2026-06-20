import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettierConfig from "eslint-config-prettier";
import tseslint from "@typescript-eslint/eslint-plugin";

const eslintConfig = [
  ...nextCoreWebVitals,
  prettierConfig,
  {
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default eslintConfig;
