import { openapi } from "@/server/main";

export async function GET() {
  return Response.json(openapi);
}
