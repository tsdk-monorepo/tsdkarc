import { toFetchHandler } from "tsdkarc-x/fetch";
import { transport } from "@/tsdkarc/main";

const handler = toFetchHandler(transport);
export const GET = handler;
export const POST = handler;
