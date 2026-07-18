# Data Processing Addendum (DPA)

> **DRAFT TEMPLATE — not legal advice.** Required before any EU/UK firm (and many
> US firms) can sign. Fill `{{PLACEHOLDERS}}` and have a lawyer review. This DPA
> forms part of the [Terms of Service](TERMS.md).

Between **{{COMPANY_LEGAL_NAME}}** ("Processor") and the subscribing firm
("Controller").

## 1. Roles & scope
The Controller determines the purposes of processing its clients' personal data;
the Processor processes it only to provide the Service and only on the Controller's
documented instructions (these terms + use of the Service).

## 2. Nature & purpose
Hosting and displaying tear-sheet/project data the Controller enters.

## 3. Categories of data & data subjects
- **Data:** project/client names, locations, notes, and product details entered by
  the Controller.
- **Data subjects:** the Controller's clients and contacts.
- The Service is **not** intended for special-category data; do not enter it.

## 4. Processor obligations
- Process only on documented instructions.
- Keep personnel under confidentiality.
- Implement appropriate security (encryption in transit/at rest, row-level
  tenant isolation, access control, least privilege).
- Assist the Controller with data-subject requests and with security/breach
  obligations, and **notify the Controller without undue delay** after becoming
  aware of a personal-data breach.
- Delete or return Customer Content on termination (see §8).

## 5. Subprocessors
The Controller authorizes these subprocessors; we will give advance notice of
changes and remain responsible for their compliance:

| Subprocessor | Purpose | Location |
|---|---|---|
| Supabase | Auth & database hosting | United States |
| Vercel | App hosting / CDN | United States |
| Anthropic | AI auto-fill extraction (product data only) | United States |

## 6. International transfers
For transfers from the EEA/UK/Switzerland, the parties incorporate the EU
**Standard Contractual Clauses** (and UK Addendum) — see Annex.

## 7. Audits
The Processor will make available information necessary to demonstrate compliance
and allow reasonable audits per {{AUDIT_TERMS}}.

## 8. Return & deletion
On termination, the Controller may export its data (JSON/Excel). The Processor
deletes Customer Content within 30 days thereafter, unless
retention is legally required.

## 9. Liability
Liability under this DPA is subject to the limitations in the [Terms](TERMS.md).

---

### Annex — Standard Contractual Clauses (placeholder)
Attach the applicable SCC modules (Controller→Processor), the UK International Data
Transfer Addendum if relevant, and the technical & organizational measures (TOMs)
summary. {{SCC_DETAILS}}
