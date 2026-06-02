# Tear Sheets — SaaS setup guide

This app is now a multi-tenant subscription product. Each **firm** (design
company) is a tenant; their users sign in and see only their own tear-sheet
projects, and only while the firm's subscription is **active**. You (the
platform owner) control access from an in-app **admin panel**.

Enforcement is server-side via Supabase Postgres Row-Level Security, so it
cannot be bypassed from the browser.

There are a handful of steps only you can do (they need your accounts). They
take about 15 minutes total.

---

## 1. Create the Supabase project

1. Go to https://supabase.com → **New project**.
2. Pick a name, a strong database password, and a region close to your users.
3. Wait for it to finish provisioning.

## 2. Create the database schema

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
3. Click **Run**. You should see "Success. No rows returned."

This creates the `firms`, `profiles`, and `projects` tables, the helper
functions, the signup trigger, and all the Row-Level Security policies.

## 3. Configure authentication

1. Go to **Authentication → Providers → Email** and make sure it's enabled.
2. (Optional, recommended while testing) **Authentication → Providers → Email →**
   turn **"Confirm email" OFF** so new users can sign in immediately without
   clicking a confirmation link. Turn it back on for production if you prefer.
3. Under **Authentication → URL Configuration**, set the **Site URL** to your
   app URL (e.g. `http://localhost:5173` for local dev, and your Vercel URL once
   deployed). You can add multiple under "Redirect URLs".

## 4. Wire the app to Supabase (local)

1. In Supabase, open **Project Settings → API**. Copy:
   - **Project URL**
   - **anon public** key (NOT the `service_role` key)
2. In the project folder, open `.env.local` and paste them:

   ```
   VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```

3. Start the app:

   ```
   npm install
   npm run dev
   ```

   Open the printed URL. You should see the **Sign in** screen (not the
   "Almost there" setup screen — if you still see that, the env vars aren't
   loaded; restart `npm run dev`).

## 5. Make yourself the platform admin

1. On the Sign in screen, click **Create one** and sign up with your email.
2. In Supabase, open **SQL Editor** and run (using your email):

   ```sql
   update public.profiles
   set role = 'platform_admin'
   where email = 'you@example.com';
   ```

3. Refresh the app. You're now in the **Platform admin** panel.

## 6. Onboard a firm (e.g. Amy Morris Interiors)

In the admin panel:

1. Under **Firms**, type the firm name and click **+ Add firm**.
2. Set its **Access** dropdown to **active** and (optionally) a **renewal date**.
3. Have the firm's designer **sign up** in the app with their own email.
4. Back in the admin panel under **Users**, find that person and set their
   **Firm** to the firm you created. Leave their role as **member**.
5. That user can now sign in and use their tear-sheet workspace.

### Cutting off a non-paying client

Set that firm's **Access** to **suspended** (or **canceled**). Their users
immediately lose access — they'll see a "subscription paused" screen — and the
database refuses to serve their projects. Flip it back to **active** to restore
access. Their data is never deleted by this.

---

## 7. Deploy to Vercel

1. Push this repo to GitHub (already done for `main`).
2. Go to https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Vite** (auto-detected). Build command and output dir are
   already set in `vercel.json`.
4. Under **Environment Variables**, add the same two values:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. **Deploy.** After it builds, add the Vercel URL to Supabase
   **Authentication → URL Configuration** (Site URL / Redirect URLs).
6. (Optional) Add a custom domain in Vercel → **Settings → Domains**.

Netlify works the same way (build `npm run build`, publish `dist`, set the two
env vars, and a SPA redirect — `vercel.json` is Vercel-specific, so on Netlify
add a `_redirects` file with `/*  /index.html  200`).

---

## Notes & future enhancements

- **Billing is manual for now** (you toggle access in the admin panel). When you
  want automated recurring billing, the natural next step is Stripe Checkout +
  a webhook (a small serverless function) that sets `firms.subscription_status`
  automatically. The data model is already shaped for it.
- **The `service_role` key** must never go in this app or the repo. Only the
  `anon` key belongs in the frontend; RLS is what keeps data safe.
- **Items are stored as JSON** inside each `projects` row, which keeps the app
  simple and fast. Filtering (vendor / collection / category / room) happens in
  the browser.
