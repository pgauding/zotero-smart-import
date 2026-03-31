// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

const config = zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        "@typescript-eslint/no-unused-vars": "off",
        // Default initializers before try/catch are flagged as useless
        // but are needed as fallbacks when the try block throws
        "no-useless-assignment": "off",
      },
    },
  ],
});

// Exclude Node scripts from Zotero's eslint config
config.push({ ignores: ["scripts/**"] });

export default config;
