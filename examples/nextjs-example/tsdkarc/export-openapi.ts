// export-openapi.ts
import { extractOpenApi } from "tsdkarc-x/openapi";
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract";
import { app } from "./main";

//  Generate openapi JSON
export const openapi = extractOpenApi(
  app.routes,
  {
    info: { title: "Nextjs Example API", version: "0.0.5" },
  },
  { entryFile: "./tsdkarc/main.ts" }
);

await app.stop();
process.exit(0);

// Generate static type of routes
/*
const result =
  await extractAppRoutesTypesFull(app.routes, {
    entryFile: "./tsdkarc/main.ts",
  });
fs.writeFile('./types/client.d.ts', result.clientDts, 'utf8');
fs.writeFile('./types/swr-client.d.ts', result.swrDts, 'utf8');
fs.writeFile('./types/react-query-client.d.ts', result.reactQueryDts, 'utf8');
fs.writeFile('./types/vue-query-client.d.ts', result.vueQueryDts, 'utf8');
*/
