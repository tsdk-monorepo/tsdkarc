"use client";

import { api } from "@/tsdkarc/client";
import { AppRoutes } from "@/tsdkarc/main";
import { useState } from "react";
import { createSwrClient } from "tsdkarc-x/react/swr";

export const apiSwr = createSwrClient<AppRoutes>(api);

export default function SwrClientExample() {
  const [enabled, setEnabled] = useState(false);
  const result = apiSwr.users.health.useQuery(null, { enabled });

  return (
    <div>
      <button onClick={() => setEnabled((state) => !state)}>
        toggle: {enabled ? "enabled" : "disabled"}
      </button>
      <pre> {JSON.stringify(result)}</pre>
    </div>
  );
}
