// scripts/gen-openapi.ts
import { extractOpenApi } from "../openapi/module";
import { writeFileSync } from "fs";

const { spec, routes } = extractOpenApi("./src/routes.ts", {
  info: { title: "My API", version: "1.0.0" },
  servers: [{ url: "http://localhost:5001" }],
});

writeFileSync("./openapi.json", JSON.stringify(spec, null, 2));
console.log(`[openapi] ${routes.length} routes → openapi.json`);