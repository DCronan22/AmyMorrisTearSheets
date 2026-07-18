# Privacy Policy

> **DRAFT TEMPLATE — not legal advice.** Fill every `{{PLACEHOLDER}}`, then have
> a lawyer review before publishing. Last updated: {{EFFECTIVE_DATE}}.

**{{COMPANY_LEGAL_NAME}}** ("we", "us") operates the Tear Sheets tear-sheet
application (the "Service"). This policy explains what we collect and why.

## 1. Who we are, and our two roles
- For **account data** (the people who log in to use the Service), we are the
  **data controller**.
- For **customer content** that a subscribing design firm enters about *its own*
  projects and clients, we act as a **data processor** on that firm's behalf and
  only on its instructions. See our [Data Processing Addendum](DPA.md).

## 2. What we collect
- **Account data:** name, email, hashed password (handled by our auth provider),
  firm assignment, and role.
- **Customer content:** project names, client names, locations, notes, and per-item
  product details (vendor, collection, category, SKU, price, dimensions, images,
  links). Firms control what they enter here.
- **Technical:** a strictly-necessary login session stored in your browser's local
  storage. We use **no advertising or analytics cookies/trackers.**

## 3. How we use it
To provide and secure the Service: authentication, access control, displaying and
exporting tear sheets, billing/subscription status, and support.

## 4. The "auto-fill from link / image" feature
When you use auto-fill, the Service fetches the public product page you provide,
or processes the image you upload, to extract product specifications. Page/image
content may be sent to our AI subprocessor (**Anthropic**) solely to extract those
fields. **We do not send your project's client names, locations, or notes to the
AI.** Anthropic does not train models on this input.

## 5. Sharing & subprocessors
We share data only with subprocessors that help run the Service:
- **Supabase** — authentication and database hosting (United States).
- **Vercel** — application hosting / CDN (United States).
- **Anthropic** — AI extraction for the auto-fill feature (United States), only
  when you use that feature.

We do **not** sell personal information. International transfers (for EU/UK firms)
rely on Standard Contractual Clauses in our [DPA](DPA.md).

## 6. Retention
Account data is kept while your account is active and for 30 days
after closure. A firm's project data is deleted on subscription termination per the
[DPA](DPA.md). You can export your data at any time (JSON / Excel).

## 7. Your rights
Depending on your location you may request access, correction, export, or deletion
of your personal data. Email **daviscronan@gmail.com**. Requests about a firm's
*client* data are routed to that firm (the controller).

## 8. Security
Data is encrypted in transit and at rest, access is enforced by database
row-level security, and each firm's data is isolated from every other firm.

## 9. Children
The Service is for business use and is not directed to children under 16.

## 10. Breach notification
If a breach affecting your personal data occurs, we will notify affected parties
and any required authorities without undue delay, consistent with applicable law.

## 11. Changes & contact
We will post changes here with a new effective date. Questions:
**daviscronan@gmail.com**, {{COMPANY_ADDRESS}}.
