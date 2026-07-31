import { toNextRouteHandlers } from "tsdkarc-x/fetch";
import { transport } from "@/server/main";

export const { GET, POST } = toNextRouteHandlers(transport);
