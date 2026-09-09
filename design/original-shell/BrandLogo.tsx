import { useEffect } from "react";
import { Link } from "react-router-dom";
import lockupSource from "./lockup.html?raw";

type Props = {
  to?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE_CLASS = {
  sm: "brand-logo--sm",
  md: "",
  lg: "brand-logo--lg",
} as const;

function parseLockup(source: string) {
  const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/i);
  const css = styleMatch?.[1]?.trim() ?? "";
  const inner = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style>[\s\S]*?<\/style>/i, "")
    .trim();
  return { css, inner };
}

const { css: LOCKUP_CSS, inner: LOCKUP_INNER } = parseLockup(lockupSource);

const STYLE_ID = "svodka-brand-lockup-css";

/** Рендер из src/brand/lockup.html — единственный источник правды. */
export function BrandLogo({ to = "/dashboard", size = "md", className = "" }: Props) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = LOCKUP_CSS;
    document.head.appendChild(style);
  }, []);

  const classes = ["brand-logo", SIZE_CLASS[size], className].filter(Boolean).join(" ");

  return (
    <Link
      to={to}
      className={classes}
      aria-label="SVODKA AI"
      dangerouslySetInnerHTML={{ __html: LOCKUP_INNER }}
    />
  );
}
