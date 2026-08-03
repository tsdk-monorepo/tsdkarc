import { toNextRouteHandlers } from "tsdkarc-x/fetch";
import { transport } from "@/tsdkarc/main";

export const { GET, POST } = toNextRouteHandlers(transport);
