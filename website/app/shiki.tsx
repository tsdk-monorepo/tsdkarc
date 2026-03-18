"use client";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

export default function Shiki({
  path,
  lang,
  theme = "dracula",
  className,
  setCode,
  defaultValue = "",
}: {
  lang: string;
  path: string;
  className?: string;
  theme?: string;
  setCode?: (code: string) => void;
  defaultValue?: string;
}) {
  const [html, setHtml] = useState(() =>
    defaultValue || ""
  );
  codeToHtml(defaultValue, {
        lang,
        theme,
      })
  useEffect(() => {
    (async () => {
      const code = defaultValue
        ? defaultValue
        : await fetch(path).then((res) => res.text());
      setCode?.(code);
      const result = await codeToHtml(code, {
        lang,
        theme,
      });
      setHtml(result);
    })();
  }, [defaultValue, path, lang, theme]);

  return (
    <pre
      contentEditable
      className={`${className} focus:ring-2 rounded-lg p-1`}
      dangerouslySetInnerHTML={{ __html: html }}></pre>
  );
}
