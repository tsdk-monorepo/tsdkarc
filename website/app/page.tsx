import fs from "fs/promises";
import HomeView from "./home";

export default async function Home() {
  const quickstart = await fs.readFile(
    "public/snippets/quickstart.ts",
    "utf-8"
  );
  return <HomeView snippets={{ quickstart }} />;
}
