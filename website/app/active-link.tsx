"use client";

import Link, { LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
  clickScrollToTop?: boolean;
} & LinkProps;

export default function NavLink({
  href,
  children,
  className = "",
  activeClassName = "active",
  clickScrollToTop = false,
  onClick,
  ...props
}: NavLinkProps) {
  const pathname = usePathname();

  const isActive = pathname === href;

  const combinedClass = [className, isActive ? activeClassName : null]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      href={href}
      className={combinedClass}
      onClick={(e) => {
        onClick?.(e);
        if (clickScrollToTop) window.scrollTo(0, 0);
      }}
      {...props}>
      {children}
    </Link>
  );
}
