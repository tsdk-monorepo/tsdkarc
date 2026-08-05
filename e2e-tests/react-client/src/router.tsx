import { useEffect, useState } from "react";

type RouteMap = Record<string, React.ReactNode>;

export function useHashRouter(routes: RouteMap) {
  const getPath = () => window.location.hash.slice(1) || "/";

  const [path, setPath] = useState(getPath);

  useEffect(() => {
    const handleHashChange = () => {
      setPath(getPath());
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  return routes[path] ?? routes["*"];
}
