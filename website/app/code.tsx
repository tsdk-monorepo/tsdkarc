"use client";

export default function Code({
  codeHtml,
  className,
}: {
  codeHtml: string;
  className?: string;
}) {
  return (
    <pre
      contentEditable
      className={`${className} focus:ring-2 rounded-lg p-1`}
      dangerouslySetInnerHTML={{ __html: codeHtml }}></pre>
  );
}
