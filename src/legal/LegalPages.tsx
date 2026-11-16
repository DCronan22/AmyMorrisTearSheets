import { useEffect } from "react";
import "../landing/landing.css";
import { SiteFooter, SiteHeader } from "../landing/SiteChrome";
import { linkTo, pathFor } from "../lib/router";
import { COMPANY, CONTACT_EMAIL } from "../lib/site";

// Terms of Service and Privacy Policy for Sorted Sheets.
// Plain-language drafts that describe how the product actually works today
// (Supabase, Vercel, Stripe, Anthropic; monthly/annual billing; 90-day
// retention after cancellation). Have counsel review before relying on them,
// and bump UPDATED + tell customers when anything material changes.

const UPDATED = "November 16, 2026";

const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · Sorted Sheets`;
    return () => {
      document.title = prev;
    };
  }, [title]);
  return (
    <div className="site">
      <SiteHeader />
      <main className="legal">
        <article className="site-wrap legal-doc">
          <h1>{title}</h1>
          <p className="legal-updated">Last updated {UPDATED}</p>
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <section className="legal-summary" aria-label="Summary">
        <h2>The short version</h2>
        <ul>
          <li>Your firm owns everything it puts into Sorted Sheets. We only use it to run the service for you.</li>
          <li>Plans renew automatically, monthly or yearly, until you cancel. Cancel anytime and keep access until the end of the period you paid for.</li>
          <li>We don't give partial refunds, and the one-time setup fee isn't refundable.</li>
          <li>Only add product photos and content you have the right to use.</li>
          <li>After you cancel we keep your data for 90 days, then delete it.</li>
        </ul>
        <p>This summary isn't a substitute for the full terms below.</p>
      </section>

      <h2>1. Who we are and what these terms cover</h2>
      <p>
        Sorted Sheets is a service of {COMPANY}, a Georgia limited liability
        company ("<strong>we</strong>", "<strong>us</strong>"). These Terms of
        Service ("<strong>Terms</strong>") govern your use of the Sorted Sheets
        website at sortedsheets.site and the Sorted Sheets application (together,
        the "<strong>Service</strong>").
      </p>
      <p>
        The Service is sold to businesses. "<strong>Customer</strong>" means the
        design firm that subscribes, and "<strong>you</strong>" means the Customer
        and each person who uses the Service under the Customer's account (a
        "<strong>User</strong>"). If you accept these Terms for a firm, you
        confirm that you're authorized to bind that firm. By creating an
        account or using the Service you agree to these Terms and to our{" "}
        <a href={pathFor("privacy")} onClick={linkTo("privacy")}>
          Privacy Policy
        </a>
        .
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>Each User needs their own account. Don't share sign-ins.</li>
        <li>Give us accurate information and keep it up to date, including your firm's billing contact.</li>
        <li>You're responsible for activity under your accounts and for keeping passwords secure. Tell us right away at <Mail /> if you think an account has been compromised.</li>
        <li>
          New firms are reviewed before they're activated. We may decline or
          close a firm's account if we reasonably believe it's being used
          fraudulently or against these Terms.
        </li>
        <li>
          The Customer decides who belongs to its firm. People whose email
          addresses the Customer approves can join the firm and see its
          projects and catalog. Tell us promptly when someone should be removed.
        </li>
      </ul>

      <h2>3. Plans, billing and renewal</h2>
      <h3>Plans</h3>
      <p>
        Plans are priced per firm by the number of Users (for example, 1–5,
        6–10 or 11–20 people). Current prices are shown on our{" "}
        <a href="/#pricing" onClick={linkTo("home", "pricing")}>
          pricing section
        </a>
        . Firms larger than our listed plans are priced by agreement. If your
        firm grows past its plan, we'll work with you to move it to the right
        plan, which may change the price from your next billing period.
      </p>
      <h3>Payment and automatic renewal</h3>
      <p>
        Payments are processed by our payment provider, Stripe. By subscribing,
        you authorize us (through Stripe) to charge your payment method:
      </p>
      <ul>
        <li><strong>Monthly plans</strong>: the monthly price at the start of each month, plus a one-time setup fee with a firm's first monthly subscription.</li>
        <li><strong>Annual plans</strong>: the annual price at the start of each year. Annual plans have no setup fee.</li>
      </ul>
      <p>
        <strong>
          Your subscription renews automatically for another period of the same
          length until you cancel.
        </strong>{" "}
        Prices don't include taxes; you're responsible for any applicable
        taxes. If a payment fails, we and Stripe may retry it, and we may
        suspend access until it's resolved.
      </p>
      <h3>Price changes</h3>
      <p>
        We may change prices. We'll email the billing contact at least 30 days
        before a change takes effect, and it will apply from your next renewal.
        If you don't want to continue at the new price, you can cancel before
        then.
      </p>
      <h3>Cancellation and refunds</h3>
      <p>
        The firm's billing contact can cancel at any time from{" "}
        <strong>Manage billing</strong> in the app, or by emailing <Mail />.
        Cancellation takes effect at the end of the current paid period, and
        you keep access until then.{" "}
        <strong>
          Fees already paid are non-refundable, including partial months or
          years and the setup fee
        </strong>
        , except where the law requires otherwise or we decide to make an
        exception.
      </p>

      <h2>4. Your content</h2>
      <p>
        "<strong>Customer Content</strong>" means everything you put into the
        Service: projects, product details, photos, logos, imported files,
        notes and branding settings.
      </p>
      <ul>
        <li><strong>You own your Customer Content.</strong> We claim no ownership of it.</li>
        <li>
          You give us a limited permission to host, copy, process, display and
          transmit Customer Content only as needed to provide, secure and
          support the Service for you (for example, to store it, create your
          exports, and run auto-fill).
        </li>
        <li>
          You're responsible for having the rights to the content you add.
          Product photos and descriptions usually belong to the vendor or
          photographer. Use them only as your agreements with vendors and the
          law allow, such as presenting products to your own clients.
        </li>
        <li>
          Auto-fill sends the product link, page text or image you provide to
          our AI provider to extract product details. Auto-filled details can
          be wrong or out of date. Check prices, dimensions and lead times
          before you rely on them.
        </li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the Service for anything illegal, or to infringe anyone's intellectual property or privacy;</li>
        <li>try to access another firm's data, or probe, scan or test the Service's security without our written permission;</li>
        <li>interfere with the Service, overload it, or get around usage limits, including by automated bulk requests;</li>
        <li>upload malware, or use the Service to send spam;</li>
        <li>resell the Service, share accounts outside your firm, or copy the Service to build a competing product.</li>
      </ul>
      <p>
        We may suspend access that breaks these rules or puts the Service or
        other customers at risk. Where we reasonably can, we'll tell you first
        and give you a chance to fix it.
      </p>

      <h2>6. Our service</h2>
      <p>
        We'll provide the Service with reasonable care and skill, and work to
        keep it secure and available. We may improve, change or remove
        features over time. If we remove something material that you rely on,
        we'll give reasonable notice. The Service, its software and design, and
        the Sorted Sheets name belong to {COMPANY}. These Terms don't give you
        any rights in them except to use the Service as described here.
      </p>
      <p>
        If you send us suggestions, we may use them without any obligation to
        you.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        The Service relies on providers such as Stripe (payments), Supabase
        (database and sign-in), Vercel (hosting) and Anthropic (AI auto-fill).
        Vendor websites you link to are run by others, and we're not
        responsible for their content or availability. See the{" "}
        <a href={pathFor("privacy")} onClick={linkTo("privacy")}>
          Privacy Policy
        </a>{" "}
        for how these providers handle data.
      </p>

      <h2>8. Ending the agreement</h2>
      <p>
        These Terms apply while you use the Service. Either side may end them:
        you by canceling, us by giving 30 days' notice, or immediately if the
        other side materially breaches them and doesn't fix it within 10 days
        of notice (or right away for non-payment or serious misuse). If we end
        the Service for reasons other than your breach, we'll refund any
        prepaid fees for the unused period.
      </p>
      <p>
        After cancellation or termination, we keep Customer Content for{" "}
        <strong>90 days</strong> so you can come back or ask for an export,
        then delete it. Copies in backups are overwritten in the normal course
        of our backup cycle. You can download project backups yourself at any
        time while your account is active.
      </p>

      <h2>9. Disclaimers</h2>
      <p className="legal-caps">
        Except as expressly stated in these Terms, the Service is provided "as
        is" and "as available". To the fullest extent permitted by law, we
        disclaim all other warranties, express or implied, including
        merchantability, fitness for a particular purpose and
        non-infringement. We don't promise that the Service will be
        uninterrupted or error-free, or that auto-filled or imported product
        information will be accurate or complete.
      </p>

      <h2>10. Limitation of liability</h2>
      <p className="legal-caps">
        To the fullest extent permitted by law, neither side will be liable for
        indirect, incidental, special, consequential or punitive damages, or
        for lost profits, revenue or data, even if advised of the possibility.
        Each side's total liability arising out of or relating to these Terms
        or the Service is limited to the fees the Customer paid us in the 12
        months before the event giving rise to the claim. These limits don't
        apply to a party's indemnity obligations, a Customer's obligation to
        pay fees, or liability that can't be limited by law.
      </p>

      <h2>11. Indemnity</h2>
      <p>
        The Customer will defend and indemnify {COMPANY} against third-party
        claims arising from Customer Content (including claims that product
        photos or other content you added infringe someone's rights) or from
        your use of the Service in breach of these Terms.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        We may update these Terms. If a change is material, we'll email the
        billing contact or show a notice in the app at least 30 days before it
        takes effect. Continuing to use the Service after that means you accept
        the updated Terms. If you don't agree, you can cancel before the change
        takes effect.
      </p>

      <h2>13. General</h2>
      <ul>
        <li>
          <strong>Governing law.</strong> These Terms are governed by the laws
          of the State of Georgia, USA, without regard to conflict-of-laws
          rules. The state and federal courts located in Georgia have exclusive
          jurisdiction, and both sides consent to them.
        </li>
        <li>
          <strong>Notices.</strong> We'll send notices to your account email or
          firm billing contact. Send notices to us at <Mail />.
        </li>
        <li>
          <strong>Assignment.</strong> You may not transfer these Terms without
          our consent. We may transfer them as part of a merger, acquisition or
          sale of our business.
        </li>
        <li>
          <strong>Force majeure.</strong> Neither side is responsible for
          delays caused by events beyond its reasonable control.
        </li>
        <li>
          <strong>Entire agreement.</strong> These Terms and the Privacy Policy
          are the whole agreement about the Service, unless we sign a separate
          written agreement with your firm. If any part is unenforceable, the
          rest still applies. Not enforcing a term isn't a waiver of it.
        </li>
      </ul>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms? Email <Mail />.
      </p>
    </LegalLayout>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <section className="legal-summary" aria-label="Summary">
        <h2>The short version</h2>
        <ul>
          <li>We collect what we need to run Sorted Sheets: your account details, your firm's projects, and billing records.</li>
          <li>We don't sell your information, and we don't use advertising or tracking cookies.</li>
          <li>Card details are handled by Stripe. We never see or store card numbers.</li>
          <li>Your firm's data is visible only to people at your firm.</li>
          <li>Email <Mail /> to see, correct, export or delete your data.</li>
        </ul>
      </section>

      <h2>1. Who we are</h2>
      <p>
        Sorted Sheets is a service of {COMPANY}, a Georgia limited liability
        company ("<strong>we</strong>", "<strong>us</strong>"). This policy
        explains what information we collect when you use sortedsheets.site and
        the Sorted Sheets app (the "<strong>Service</strong>"), how we use it,
        and the choices you have. Questions go to <Mail />.
      </p>
      <p>
        For the projects and product information a design firm stores in the
        Service, the firm decides what goes in and who can see it. We process
        that content on the firm's behalf, as described in our{" "}
        <a href={pathFor("terms")} onClick={linkTo("terms")}>
          Terms of Service
        </a>
        .
      </p>

      <h2>2. What we collect</h2>
      <table className="legal-table">
        <thead>
          <tr>
            <th scope="col">Information</th>
            <th scope="col">Examples</th>
            <th scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Account details</td>
            <td>Name, email address, password (stored only as a secure hash), firm name, and your role</td>
            <td>To create your account, sign you in and connect you to your firm</td>
          </tr>
          <tr>
            <td>Firm sign-up requests</td>
            <td>Firm name, the email addresses of people who need access, and any note you include</td>
            <td>To review and set up your firm, and let approved teammates join</td>
          </tr>
          <tr>
            <td>Customer content</td>
            <td>Projects, clients' project names and locations you enter, product details, photos, logos, imported files and branding settings</td>
            <td>To provide the Service: storing, displaying and exporting your work</td>
          </tr>
          <tr>
            <td>Billing records</td>
            <td>Plan, billing contact and subscription status. Stripe holds your payment details and invoices; we never receive full card numbers</td>
            <td>To charge for the Service, send receipts and manage your plan</td>
          </tr>
          <tr>
            <td>Usage and technical data</td>
            <td>IP address, browser type, request logs and error logs, and counts of auto-fill requests</td>
            <td>To keep the Service secure and working, prevent abuse and enforce fair-use limits</td>
          </tr>
          <tr>
            <td>Messages</td>
            <td>Emails you send us</td>
            <td>To answer you and provide support</td>
          </tr>
        </tbody>
      </table>
      <p>
        We don't knowingly collect sensitive personal information, and the
        Service isn't meant for anyone under 16.
      </p>

      <h2>3. How we use information</h2>
      <ul>
        <li>to provide, maintain and improve the Service;</li>
        <li>to sign you in and keep each firm's data separate and secure;</li>
        <li>to bill for the Service and send receipts and account emails (sign-up confirmation, password resets, billing notices);</li>
        <li>to respond to support requests;</li>
        <li>to detect and prevent fraud, abuse and security incidents; and</li>
        <li>to meet legal obligations.</li>
      </ul>
      <p>
        <strong>We don't sell or rent personal information</strong>, and we
        don't share it for cross-context advertising. We don't use your
        customer content to train AI models, and our AI provider doesn't use
        it to train theirs under the terms we use it on.
      </p>

      <h2>4. Who we share it with</h2>
      <p>We share information only with service providers that help us run the Service, under contracts that limit their use of it:</p>
      <table className="legal-table">
        <thead>
          <tr>
            <th scope="col">Provider</th>
            <th scope="col">What they do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Supabase</td>
            <td>Database, file storage, sign-in, and account emails</td>
          </tr>
          <tr>
            <td>Vercel</td>
            <td>Hosting the website and app, and server functions</td>
          </tr>
          <tr>
            <td>Stripe</td>
            <td>Payment processing, invoices and the billing portal</td>
          </tr>
          <tr>
            <td>Anthropic</td>
            <td>AI auto-fill: reads the product page text or image you submit to extract product details</td>
          </tr>
          <tr>
            <td>Google Fonts</td>
            <td>Serving the typefaces the site uses (your browser requests them from Google, which receives your IP address)</td>
          </tr>
        </tbody>
      </table>
      <p>
        When you auto-fill from a product link, our servers fetch that page
        from the vendor's website. We may also disclose information if the law
        requires it, to protect rights and safety, or as part of a merger or
        sale of our business (we'd tell you first).
      </p>
      <p>
        Inside your firm, everyone your firm has approved can see the firm's
        projects and catalog. Other firms can't.
      </p>

      <h2>5. Cookies and local storage</h2>
      <p>
        We don't use advertising or analytics cookies. The app stores your
        sign-in session and a few display preferences in your browser's local
        storage so you stay signed in and your settings stick. Stripe sets its
        own cookies on its checkout and billing pages to process payments and
        prevent fraud.
      </p>

      <h2>6. How long we keep it</h2>
      <ul>
        <li>We keep account and customer content while your firm's account is active.</li>
        <li>After a firm cancels, we keep its data for <strong>90 days</strong>, then delete it. Backups are overwritten in the normal course of our backup cycle.</li>
        <li>We keep billing records as long as tax and accounting law requires.</li>
        <li>Server logs are kept for a limited time for security and troubleshooting.</li>
      </ul>

      <h2>7. Security</h2>
      <p>
        Data is encrypted in transit (HTTPS) and at rest by our providers.
        Every firm's data is separated by access rules in the database itself,
        so one firm can't read another's. Passwords are stored only as hashes.
        No system is perfectly secure; if a breach affects your information,
        we'll notify you as the law requires.
      </p>

      <h2>8. Your choices and rights</h2>
      <p>You can ask us to:</p>
      <ul>
        <li>give you a copy of your information, or an export of your firm's data;</li>
        <li>correct information that's wrong;</li>
        <li>delete your account or your firm's data; or</li>
        <li>stop processing your information for a particular purpose, where the law gives you that right.</li>
      </ul>
      <p>
        Email <Mail /> from the address on your account. We'll confirm the
        request and respond within 30 days (or sooner where the law requires).
        Requests about a firm's shared content may need the firm's billing
        contact to agree. Depending on where you live, you may also have the
        right to complain to a data-protection authority. We won't treat you
        differently for exercising your rights.
      </p>

      <h2>9. Where data is stored</h2>
      <p>
        We're based in the United States, and our providers process data in
        the United States and other countries. By using the Service you
        understand your information will be processed there.
      </p>

      <h2>10. Changes</h2>
      <p>
        We'll update this policy as the Service changes. If a change is
        material, we'll email account holders or show a notice in the app
        before it takes effect. The date at the top shows when it last changed.
      </p>

      <h2>11. Contact</h2>
      <p>
        {COMPANY}, doing business as Sorted Sheets. Email <Mail />.
      </p>
    </LegalLayout>
  );
}
