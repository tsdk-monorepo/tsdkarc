import { generateAndWrite } from "../openapi/codegen/openapi-to-routes";

generateAndWrite("./src/x/demos/x.json", "./src/x/demos/x.generated.ts", {
  moduleName: "xModule",
  mode: "both",
  baseUrl: "http://localhost:5001",
});
