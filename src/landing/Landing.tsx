import { useState } from "react";
import "./landing.css";
import { linkTo, pathFor } from "../lib/router";
import type { BillingInterval } from "../types";
import {
  annualPriceUsd,
  MAX_LISTED_SEATS,
  SETUP_FEE_USD,
  TIER_LABEL,
  TIER_PRICE_USD,
  TIER_SEATS,
  TIERS,
} from "../lib/tiers";
import { SiteFooter, SiteHeader } from "./SiteChrome";
import { CONTACT_EMAIL } from "../lib/site";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Public homepage, shown at / to anyone who isn't signed in. */
export default function Landing() {
  return (
    <div className="site">
      <SiteHeader />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Demo />
        <Features />
        <Spotlights />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="site-wrap hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">For interior design firms</p>
          <h1>
            Paste a link.
            <br />
            Get a tear sheet.
          </h1>
          <p className="hero-lede">
            Sorted Sheets turns vendor product pages into polished, on-brand
            tear sheets and keeps every one in your firm's library. Build a
            tear sheet once, then reuse it on every project after.
          </p>
          <div className="hero-ctas">
            <a className="btn primary site-btn-lg" href={pathFor("signup")} onClick={linkTo("signup")}>
              Get started
            </a>
            <a className="btn ghost site-btn-lg" href="#demo" onClick={linkTo("home", "demo")}>
              Watch the demo
            </a>
          </div>
          <p className="hero-note">
            One price for your whole firm, from {usd(TIER_PRICE_USD.small)}/month. Cancel anytime.
          </p>
        </div>
        <figure className="hero-shot">
          <BrowserFrame>
            <img
              src="/home/hero.webp"
              width={1440}
              height={900}
              alt="A client project in Sorted Sheets: product photos grouped by room, with a running total for each room."
              fetchPriority="high"
            />
          </BrowserFrame>
        </figure>
      </div>
    </section>
  );
}

function BrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="browser">
      <div className="browser-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <div className="browser-url">sortedsheets.site</div>
      </div>
      <div className="browser-body">{children}</div>
    </div>
  );
}

function Problem() {
  const pains = [
    {
      title: "Copy, paste, repeat",
      body: "Photo from one tab, price from another, dimensions buried in a paragraph. Every piece, every deck.",
    },
    {
      title: "The same sofa, again",
      body: "You specced it last spring. Today you're typing it in from scratch because it lives in an old file.",
    },
    {
      title: "Formatting at midnight",
      body: "Lining up photos, fixing fonts, re-totaling the living room after the client swaps a lamp.",
    },
  ];
  return (
    <section className="problem" aria-labelledby="problem-title">
      <div className="site-wrap">
        <h2 id="problem-title" className="section-title">
          Client presentations shouldn't take the whole afternoon.
        </h2>
        <div className="problem-grid">
          {pains.map((p) => (
            <div className="problem-card" key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
        <p className="problem-turn">
          With Sorted Sheets you build each tear sheet once. After that, it's one click.
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "1",
      title: "Paste a product link",
      body: "Name, photo, price, dimensions, materials and lead time fill themselves in, even when the vendor buries the specs in a paragraph. If a site won't share, drop in a screenshot and it reads that instead.",
    },
    {
      n: "2",
      title: "Reuse it on every project",
      body: "Every tear sheet is saved to your firm's database. Next project, pull the same sofa in with one click. No retyping, no rebuilding, no digging through old decks.",
    },
    {
      n: "3",
      title: "Organize by room",
      body: "Every piece lands in a project, grouped by room, with a running total for each one. Filter by vendor, collection or category, and find anything with search.",
    },
    {
      n: "4",
      title: "Present, print or export",
      body: "Show it full-screen in the client meeting, print polished one-per-page tear sheets or save them as a PDF, or export a PowerPoint deck to keep editing. All in your firm's branding.",
    },
  ];
  return (
    <section className="how" id="how" aria-labelledby="how-title">
      <div className="site-wrap">
        <p className="eyebrow">How it works</p>
        <h2 id="how-title" className="section-title">
          From vendor page to client-ready, and ready again next time.
        </h2>
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.n}>
              <span className="step-n" aria-hidden="true">
                {s.n}
              </span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Demo() {
  return (
    <section className="demo" id="demo" aria-labelledby="demo-title">
      <div className="site-wrap">
        <p className="eyebrow">See it work</p>
        <h2 id="demo-title" className="section-title">
          A quick tour.
        </h2>
        <p className="section-lede">
          A product link becomes a finished tear sheet, a saved piece gets
          reused on a new project, and a room goes up on the screen, onto paper
          and into PowerPoint.
        </p>
        <div className="demo-frame">
          <BrowserFrame>
            <video
              controls
              playsInline
              preload="metadata"
              poster="/home/demo-poster.webp"
              width={1440}
              height={900}
            >
              <source src="/home/demo.mp4" type="video/mp4" />
              Your browser can't play this video.
            </video>
          </BrowserFrame>
        </div>
      </div>
    </section>
  );
}

const FEATURES: { title: string; body: string; icon: keyof typeof ICONS }[] = [
  {
    icon: "library",
    title: "Reuse, don't recreate",
    body: "Every tear sheet you make is saved to your firm's database. Drop it into any future project in one click, photo, specs and pricing included.",
  },
  {
    icon: "link",
    title: "Link auto-fill",
    body: "Paste any vendor's product page. AI reads it and fills in the name, photo, price, dimensions, materials and more.",
  },
  {
    icon: "camera",
    title: "Reads screenshots too",
    body: "When a site blocks auto-fill, a screenshot or product photo works just as well. You're never stuck typing.",
  },
  {
    icon: "upload",
    title: "Bring your old sheets",
    body: "Import existing spec sheets from Excel or CSV, PowerPoint and PDF tear-sheet decks, or Word forms. Day one isn't day zero.",
  },
  {
    icon: "rooms",
    title: "Rooms and running totals",
    body: "Group by room and see each room's total update as you go. Answer \"where are we on the bedroom?\" on the spot.",
  },
  {
    icon: "brush",
    title: "Your branding",
    body: "Your logo, colors and fonts on every page. Choose whether prices, SKUs, dimensions and rooms show. Set it once.",
  },
  {
    icon: "present",
    title: "Present, print, export",
    body: "Full-screen slideshow for meetings, print-ready tear sheets and PDFs, and PowerPoint decks you can keep editing.",
  },
  {
    icon: "box",
    title: "Inventory",
    body: "Track pieces you have on hand with quantities, net and retail pricing, and export inventory detail forms to Word or PowerPoint.",
  },
  {
    icon: "lock",
    title: "Your team, your data",
    body: "Everyone at your firm works in one shared account. Your projects and catalog are walled off from every other firm.",
  },
];

const ICONS = {
  link: <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />,
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  library: (
    <>
      <rect x="4" y="4" width="6" height="16" rx="1" />
      <rect x="14" y="4" width="6" height="16" rx="1" />
      <path d="M7 8h0M17 8h0" />
    </>
  ),
  upload: <path d="M12 16V4m0 0-4 4m4-4 4 4M5 15v4h14v-4" />,
  rooms: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 12h9M13 4v16" />
    </>
  ),
  brush: <path d="M14 4l6 6-8 8H6v-6zM4 20h4" />,
  present: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M12 16v4M8 20h8" />
    </>
  ),
  box: (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path d="M4 8l8 4 8-4M12 12v8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
};

function Features() {
  return (
    <section className="features" id="features" aria-labelledby="features-title">
      <div className="site-wrap">
        <p className="eyebrow">Features</p>
        <h2 id="features-title" className="section-title">
          Everything a design firm needs to spec and present.
        </h2>
        <p className="section-lede">Every plan includes every feature. Plans differ only by team size.</p>
        <ul className="feature-grid">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <svg className="feature-icon" viewBox="0 0 24 24" aria-hidden="true">
                {ICONS[f.icon]}
              </svg>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Spotlights() {
  const rows = [
    {
      img: "/home/database.webp",
      alt: "The firm database: a grid of saved pieces with search and vendor, collection and category filters.",
      kicker: "Build once, reuse forever",
      title: "Never recreate a tear sheet again.",
      body: "Every piece you spec is saved to your firm's database with its photo, specs and price. Starting a new project? Pull in the chair from last spring's job with one click instead of rebuilding its tear sheet from scratch. Your library grows with every project, and it's shared with your whole team.",
    },
    {
      bare: true,
      img: "/home/sheet.webp",
      alt: "A finished tear sheet with the firm's logo, a large product photo, and the piece's dimensions, materials and price.",
      kicker: "The deliverable",
      title: "Tear sheets your clients will actually read.",
      body: "One piece per page, a big photo, the details that matter, and your logo at the top. Print them, save a PDF for email, or export to PowerPoint when you want to keep tweaking.",
    },
    {
      img: "/home/present.webp",
      alt: "Present mode showing four living-room pieces on one screen, with a Vendor names switch in the toolbar.",
      kicker: "The meeting",
      title: "Walk clients through it, full-screen.",
      body: "Present mode turns a project into a clean slideshow: one piece at a time, or a whole room on one screen. Hide vendor names with one switch when you'd rather keep your sources to yourself.",
    },
  ];
  return (
    <section className="spotlights" aria-label="Highlights">
      <div className="site-wrap">
        {rows.map((r, i) => (
          <div className={`spotlight${i % 2 ? " is-flipped" : ""}`} key={r.img}>
            <figure className={r.bare ? "spotlight-bare" : undefined}>
              {r.bare ? (
                <img src={r.img} width={1440} height={900} alt={r.alt} loading="lazy" />
              ) : (
                <BrowserFrame>
                  <img src={r.img} width={1440} height={900} alt={r.alt} loading="lazy" />
                </BrowserFrame>
              )}
            </figure>
            <div className="spotlight-copy">
              <p className="eyebrow">{r.kicker}</p>
              <h2 className="section-title">{r.title}</h2>
              <p>{r.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pricing() {
  const [interval, setInterval_] = useState<BillingInterval>("month");
  return (
    <section className="pricing" id="pricing" aria-labelledby="pricing-title">
      <div className="site-wrap">
        <p className="eyebrow">Pricing</p>
        <h2 id="pricing-title" className="section-title">
          One flat price for your whole firm.
        </h2>
        <p className="section-lede">
          Every plan includes every feature, with unlimited projects and pieces.
          Choose the size that fits your team.
        </p>
        <div className="interval-switch" role="radiogroup" aria-label="Billing period">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              className={interval === i ? "is-on" : undefined}
              onClick={() => setInterval_(i)}
            >
              {i === "month" ? "Monthly" : "Annual"}
              {i === "year" && <span className="switch-tag">1 month free</span>}
            </button>
          ))}
        </div>
        <ul className="plan-grid">
          {TIERS.map((t) => {
            const { min, max } = TIER_SEATS[t];
            return (
              <li key={t} className="plan">
                <h3>{TIER_LABEL[t]}</h3>
                <p className="plan-seats">
                  {min}–{max} people
                </p>
                <p className="plan-price">
                  {interval === "month" ? usd(TIER_PRICE_USD[t]) : usd(annualPriceUsd(t))}
                  <span>/{interval === "month" ? "month" : "year"}</span>
                </p>
                <p className="plan-sub">
                  {interval === "month"
                    ? `Plus a one-time ${usd(SETUP_FEE_USD)} setup fee`
                    : `Works out to ${usd(Math.round(annualPriceUsd(t) / 12))}/month. No setup fee.`}
                </p>
                <ul className="plan-list">
                  <li>Up to {max} team accounts</li>
                  <li>Unlimited projects and pieces</li>
                  <li>Every feature included</li>
                  <li>Cancel anytime</li>
                </ul>
                <a
                  className="btn primary plan-cta"
                  href={pathFor("signup")}
                  onClick={linkTo("signup")}
                >
                  Get started
                </a>
              </li>
            );
          })}
        </ul>
        <p className="pricing-foot">
          More than {MAX_LISTED_SEATS} people?{" "}
          <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Sorted Sheets pricing for a larger firm")}`}>
            Email us
          </a>{" "}
          for a custom price.
        </p>
      </div>
    </section>
  );
}

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "How does signing up work?",
    a: (
      <>
        Create an account, then tell us your firm's name and the email address
        of everyone who needs access. We review the request and set up your
        firm. Then you choose monthly or annual billing, and you're in.
      </>
    ),
  },
  {
    q: "How do my teammates get in?",
    a: (
      <>
        Anyone whose email you listed simply creates an account with that
        address and confirms it. They join your firm automatically, so nobody
        has to be added by hand. Need to add someone later? Just email us.
      </>
    ),
  },
  {
    q: "What counts as an account?",
    a: <>Each person who signs in. Plans are priced by how many people at your firm need access, not by projects or pieces.</>,
  },
  {
    q: "Can we reuse tear sheets across projects?",
    a: (
      <>
        Yes, that's the point. Every piece is saved to your firm's database.
        Add it to any new project in a click and it arrives with its photo,
        specs and price. Edit the saved version once and future projects get
        the update.
      </>
    ),
  },
  {
    q: "What if a product link doesn't auto-fill?",
    a: (
      <>
        Some vendor sites publish very little or block automated reading. Take a
        screenshot of the page and Sorted Sheets reads the image instead, or
        fill in the fields yourself. Auto-fill is a head start, never a
        requirement.
      </>
    ),
  },
  {
    q: "Can we bring in the tear sheets we already have?",
    a: (
      <>
        Yes. Import spreadsheets (Excel or CSV), PowerPoint and PDF tear-sheet
        decks, and Word inventory forms. Each slide, page or row becomes a
        piece you can reuse.
      </>
    ),
  },
  {
    q: "Who can see our projects?",
    a: (
      <>
        Only people at your firm. Every firm's data is kept separate in the
        database itself, not just hidden on screen.
      </>
    ),
  },
  {
    q: "Can we cancel?",
    a: (
      <>
        Anytime, from the billing page. You keep access until the end of the
        month or year you've paid for. We don't give partial refunds, and the
        setup fee isn't refundable.
      </>
    ),
  },
  {
    q: "What happens to our data if we cancel?",
    a: (
      <>
        We keep it for 90 days in case you come back, then delete it for good.
        You can download a backup of any project whenever you like.
      </>
    ),
  },
  {
    q: "How do payments work?",
    a: (
      <>
        Payments are handled by Stripe. We never see or store your card number.
        Monthly plans renew each month; annual plans renew each year and include
        one month free.
      </>
    ),
  },
];

function Faq() {
  return (
    <section className="faq" id="faq" aria-labelledby="faq-title">
      <div className="site-wrap faq-wrap">
        <div>
          <p className="eyebrow">Questions</p>
          <h2 id="faq-title" className="section-title">
            Good questions, straight answers.
          </h2>
          <p className="section-lede">
            Something else? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </div>
        <div className="faq-list">
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="final-cta" aria-labelledby="final-title">
      <div className="site-wrap">
        <h2 id="final-title">Give your team its afternoons back.</h2>
        <p>Request your firm in a couple of minutes. Questions first? Email us anytime.</p>
        <div className="hero-ctas">
          <a className="btn primary site-btn-lg" href={pathFor("signup")} onClick={linkTo("signup")}>
            Get started
          </a>
          <a className="btn ghost site-btn-lg on-dark" href={pathFor("login")} onClick={linkTo("login")}>
            Log in
          </a>
        </div>
      </div>
    </section>
  );
}
