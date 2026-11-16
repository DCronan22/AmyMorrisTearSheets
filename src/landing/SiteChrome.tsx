import { useEffect, useState } from "react";
import { linkTo, pathFor } from "../lib/router";
import { COMPANY, CONTACT_EMAIL } from "../lib/site";

/** The "SS" mark + wordmark, linking home. */
export function SiteLogo({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <a className={`site-logo is-${tone}`} href={pathFor("home")} onClick={linkTo("home")}>
      <span className="brand-mark" aria-hidden="true">
        SS
      </span>
      <span className="site-logo-name">Sorted Sheets</span>
    </a>
  );
}

const SECTIONS: { id: string; label: string }[] = [
  { id: "how", label: "How it works" },
  { id: "features", label: "Features" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];

/** Sticky top bar for the public pages. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the phone menu with Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className={`site-header${scrolled ? " is-scrolled" : ""}${open ? " is-open" : ""}`}>
      <div className="site-wrap site-header-row">
        <SiteLogo />
        <nav className="site-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`/#${s.id}`}
              onClick={(e) => {
                setOpen(false);
                linkTo("home", s.id)(e);
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <div className="site-actions">
          <a className="site-login" href={pathFor("login")} onClick={linkTo("login")}>
            Log in
          </a>
          <a className="btn primary" href={pathFor("signup")} onClick={linkTo("signup")}>
            Get started
          </a>
          <button
            type="button"
            className="site-menu-btn"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
      {open && (
        <nav className="site-menu" id="site-menu" aria-label="Menu">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`/#${s.id}`}
              onClick={(e) => {
                setOpen(false);
                linkTo("home", s.id)(e);
              }}
            >
              {s.label}
            </a>
          ))}
          <a href={pathFor("login")} onClick={linkTo("login")}>
            Log in
          </a>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-wrap site-footer-grid">
        <div>
          <SiteLogo tone="light" />
          <p className="site-footer-tag">Tear sheets for interior designers.</p>
        </div>
        <nav aria-label="Product">
          <h2>Product</h2>
          <a href="/#features" onClick={linkTo("home", "features")}>
            Features
          </a>
          <a href="/#pricing" onClick={linkTo("home", "pricing")}>
            Pricing
          </a>
          <a href="/#faq" onClick={linkTo("home", "faq")}>
            FAQ
          </a>
        </nav>
        <nav aria-label="Account">
          <h2>Account</h2>
          <a href={pathFor("signup")} onClick={linkTo("signup")}>
            Get started
          </a>
          <a href={pathFor("login")} onClick={linkTo("login")}>
            Log in
          </a>
        </nav>
        <nav aria-label="Company">
          <h2>Company</h2>
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
          <a href={pathFor("terms")} onClick={linkTo("terms")}>
            Terms of Service
          </a>
          <a href={pathFor("privacy")} onClick={linkTo("privacy")}>
            Privacy Policy
          </a>
        </nav>
      </div>
      <div className="site-wrap site-footer-legal">
        <span>
          © {year} {COMPANY}. Sorted Sheets is a service of {COMPANY}.
        </span>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </div>
    </footer>
  );
}
