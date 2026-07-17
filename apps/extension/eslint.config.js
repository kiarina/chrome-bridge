export default [
  {
    ignores: ["dist/**", "node_modules/**", "tests/.generated/**"],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        Blob: "readonly",
        FileReader: "readonly",
        Image: "readonly",
        MediaRecorder: "readonly",
        OffscreenCanvas: "readonly",
        URL: "readonly",
        WebSocket: "readonly",
        chrome: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        createImageBitmap: "readonly",
        crypto: "readonly",
        document: "readonly",
        fetch: "readonly",
        location: "readonly",
        performance: "readonly",
        process: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
