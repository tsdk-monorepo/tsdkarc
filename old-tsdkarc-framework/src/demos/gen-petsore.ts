import { generateAndWrite } from "../openapi/codegen/openapi-to-routes";

generateAndWrite("./src/x/demos/petsore.json", "./src/x/demos/petstore.generated.ts", {
  moduleName: "petsoreModule",
  mode: "both",
  baseUrl: "https://api.petstore.com",
});
