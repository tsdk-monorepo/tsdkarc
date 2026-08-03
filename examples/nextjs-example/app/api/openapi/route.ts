import { openapi } from "@/tsdkarc/main";

export async function GET() {
  return Response.json(openapi);
}
