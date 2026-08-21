import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      /**
       * Parametro prefixado com `_` e deliberadamente nao usado.
       *
       * Existe por causa de `lib/billing/aws-invoicing.ts`, cujas funcoes ja tem
       * a assinatura FINAL da integracao que ainda nao existe: quem chamar hoje
       * continua funcionando quando a implementacao chegar. Apagar os parametros
       * para calar o aviso obrigaria a mudar todo chamador depois -- que e
       * exatamente o custo que a assinatura estavel evita.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
