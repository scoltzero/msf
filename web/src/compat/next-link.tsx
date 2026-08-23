import { Link, type LinkProps } from "react-router-dom";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type NextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: LinkProps["to"];
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
  children?: ReactNode;
};

export default function NextLink({
  href,
  replace,
  prefetch: _prefetch,
  scroll: _scroll,
  children,
  ...props
}: NextLinkProps) {
  return (
    <Link to={href} replace={replace} {...props}>
      {children}
    </Link>
  );
}
