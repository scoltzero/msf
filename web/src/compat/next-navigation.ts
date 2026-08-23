import {
  useLocation,
  useNavigate,
  useSearchParams as useReactRouterSearchParams,
} from "react-router-dom";

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => window.location.reload(),
  };
}

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  return useReactRouterSearchParams()[0];
}

export function redirect(href: string): never {
  window.location.replace(href);
  throw new Error(`Redirecting to ${href}`);
}
