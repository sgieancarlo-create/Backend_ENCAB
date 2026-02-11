# Deploy backend to Vercel

## 1. Deploy from GitHub

1. Push your repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → **Import** your repo.
3. Set **Root Directory** to **`backend`**.
4. Add **Environment Variables** (Settings → Environment Variables):
   - **DB:** `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (Aiven values)
   - **Auth:** `JWT_SECRET`, `BACKEND_API_KEY`
   - **Uploads (optional):** `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`
   - For Aiven cert errors: `DB_SSL_CA` (PEM from Aiven dashboard)
5. Click **Deploy**.

## 2. Deploy from CLI

```bash
cd backend
npx vercel
```

Add env vars in the Vercel dashboard, then redeploy.

## 3. After deploy

API base URL: **`https://<your-project>.vercel.app/api`**

Example: `https://backend-encab.vercel.app/api/auth/login`

Your Expo and admin-web apps use this URL in production.
