import fs from "fs/promises";
import DocsView from "./docs";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation",
};

export default async function Docs() {
  const [quickstart, dependencyChain, patterns, apiModule, apiStart] =
    await Promise.all([
      fs.readFile("public/snippets/quickstart.ts", "utf-8"),
      fs.readFile("public/snippets/dependency-chain.ts", "utf-8"),
      fs.readFile("public/snippets/patterns.ts", "utf-8"),
      fs.readFile("public/snippets/api.ts", "utf-8"),
      fs.readFile("public/snippets/api-start.ts", "utf-8"),
    ]);
  return (
    <DocsView
      snippets={{
        quickstart,
        dependencyChain,
        patterns,
        apiModule,
        apiStart,
      }}
    />
  );
}
