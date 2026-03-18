import fs from "fs/promises";
import HomeView from "./home";
import { codeToHtml } from "shiki";

export default async function Home() {
  const quickstart = await fs.readFile(
    "public/snippets/quickstart.ts",
    "utf-8"
  );
  const quickstartHTML = await codeToHtml(quickstart, {
    theme: "dracula",
    lang: "ts",
  });
  return <HomeView snippets={{ quickstart, quickstartHTML }} />;
}
