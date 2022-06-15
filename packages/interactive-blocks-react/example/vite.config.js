/* eslint-env node */
import * as path from "path";

export default {
  mode: "development",
  root: __dirname,
  base: "./",
  resolve: {
    alias: {
      "@lyonbot/interactive-blocks-react": path.resolve(__dirname, ".."),
    },
  },
};
