# Google Cloud Setup Guide — The Cinematic Narrator

Complete, step-by-step guide to setting up all Google Cloud services.
Nothing is skipped. Do these steps in order.

---

## Prerequisites

Before starting, make sure you have:
- A Google account
- A credit card for Google Cloud (there is a free tier; you won't be charged if you stay within limits)
- Python 3.10+ installed locally
- `gcloud` CLI installed (instructions in Step 1)

---

## Step 1 — Install the Google Cloud CLI (`gcloud`)

1. Go to: https://cloud.google.com/sdk/docs/install
2. Download the installer for your OS (macOS/Windows/Linux)
3. Run the installer and follow the prompts
4. Open a new terminal and verify:
   ```bash
   gcloud --version
   ```
   You should see output like: `Google Cloud SDK 460.x.x`

---

## Step 2 — Create a Google Cloud Project

1. Go to: https://console.cloud.google.com
2. Click the project dropdown at the top (next to "Google Cloud")
3. Click **"New Project"**
4. Set:
   - **Project name:** `cinematic-narrator` (or any name you want)
   - **Project ID:** Note this carefully — it looks like `cinematic-narrator-123456`
5. Click **"Create"**
6. Wait ~30 seconds, then select your new project from the dropdown

---

## Step 3 — Enable Billing

Google Cloud requires billing to be enabled to use most services (even free tier).

1. In the console, go to: **Billing** (search in top bar)
2. Click **"Link a billing account"** if not already linked
3. Add a payment method if needed
4. Link it to your project

> Note: Gemini API calls, Cloud Run, and Cloud Storage all have generous free tiers. You will not be charged for reasonable hackathon usage.

---

## Step 4 — Enable Required APIs

Run these commands in your terminal (one by one):

```bash
# Authenticate first
gcloud auth login

# Set your project (replace with YOUR project ID)
gcloud config set project YOUR_PROJECT_ID

# Enable all required APIs
gcloud services enable run.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable firestore.googleapis.com
gcloud services enable texttospeech.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

Each command takes 30-60 seconds. You'll see "Operation ... finished successfully."

---

## Step 5 — Get Your Gemini API Key

The Gemini API key is separate from Google Cloud credentials.

1. Go to: https://aistudio.google.com/app/apikey
2. Click **"Create API key"**
3. Select your Google Cloud project from the dropdown
4. Click **"Create API key in existing project"**
5. Copy the key — it looks like: `AIzaSy...`
6. Save it somewhere safe (you'll add it to `.env` shortly)

---

## Step 6 — Create a Service Account (for Cloud services)

The service account allows your app to access Cloud Storage, Firestore, and TTS.

```bash
# Create the service account
gcloud iam service-accounts create cinematic-narrator-sa \
  --display-name="Cinematic Narrator Service Account"

# Grant required roles
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:cinematic-narrator-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:cinematic-narrator-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Note: Cloud TTS has no project-level IAM role — API enablement (Step 4) is sufficient.

# Download the JSON key file
gcloud iam service-accounts keys create ./service-account-key.json \
  --iam-account="cinematic-narrator-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

This creates a file called `service-account-key.json` in your current directory.

> IMPORTANT: Never commit this file to git. It's already in `.gitignore`.

---

## Step 7 — Create a Cloud Storage Bucket

```bash
# Replace YOUR_PROJECT_ID with your actual project ID
gsutil mb -p YOUR_PROJECT_ID -l us-central1 gs://cinematic-narrator-assets-YOUR_PROJECT_ID/
```

> The bucket name must be globally unique. If it fails, try adding a number suffix.

Note the bucket name — you'll use it in `.env`.

---

## Step 8 — Set Up Firestore

1. Go to: https://console.cloud.google.com/firestore
2. Click **"Create database"**
3. Choose **"Native mode"** (not Datastore mode)
4. Select location: **us-central1** (or your preferred region)
5. Click **"Create database"**
6. Wait ~1 minute for it to provision

No further setup needed — the app creates collections automatically.

---

## Step 9 — Configure Your `.env` File

Open the `.env` file in the project root and fill in all values:

```env
# Your GCP project ID (from Step 2)
GOOGLE_CLOUD_PROJECT=cinematic-narrator-123456

# Region (keep as us-central1 unless you chose differently)
GOOGLE_CLOUD_REGION=us-central1

# Bucket name from Step 7
GCS_BUCKET_NAME=cinematic-narrator-assets-cinematic-narrator-123456

# Firestore collection (can keep as default)
FIRESTORE_COLLECTION=narrator-sessions

# Gemini API key from Step 5
GEMINI_API_KEY=AIzaSy...your-key-here...

# Path to service account key from Step 6
GOOGLE_APPLICATION_CREDENTIALS=/full/path/to/service-account-key.json

# Enable cloud services
USE_CLOUD_STORAGE=true
USE_FIRESTORE=true
USE_CLOUD_TTS=true
```

> For the `GOOGLE_APPLICATION_CREDENTIALS` path, use the absolute path.
> On Mac, run `pwd` in the project directory to get the base path.

---

## Step 10 — Test Locally

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Copy .env into backend directory OR run from project root
cp ../.env .env

# Start the server
python main.py
```

Open your browser at: `http://localhost:8080`

Upload a file (try a text file first), enter a prompt, and click "Begin Cinematic Experience".

You should see the loading screen, then the cinematic player with images, captions, and audio.

---

## Step 11 — Deploy to Cloud Run

### Option A: Deploy from source (simplest)

```bash
cd backend

gcloud run deploy cinematic-narrator \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --service-account cinematic-narrator-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars "GEMINI_API_KEY=your-key,GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GCS_BUCKET_NAME=your-bucket,USE_CLOUD_STORAGE=true,USE_FIRESTORE=true,USE_CLOUD_TTS=true,FIRESTORE_COLLECTION=narrator-sessions"
```

This will:
- Build a Docker container in the cloud
- Push it to Artifact Registry
- Deploy to Cloud Run

After ~3 minutes, you'll get a URL like: `https://cinematic-narrator-xxxx-uc.a.run.app`

### Option B: Build and deploy manually

```bash
# Build the Docker image
cd backend
docker build -t gcr.io/YOUR_PROJECT_ID/cinematic-narrator:latest .

# Push to Container Registry
docker push gcr.io/YOUR_PROJECT_ID/cinematic-narrator:latest

# Deploy
gcloud run deploy cinematic-narrator \
  --image gcr.io/YOUR_PROJECT_ID/cinematic-narrator:latest \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600
```

---

## Step 12 — Update CORS for Production

After deployment, update your Cloud Run service to allow your domain:

```bash
gcloud run services update cinematic-narrator \
  --region us-central1 \
  --update-env-vars "CORS_ORIGINS=https://your-cloud-run-url.a.run.app"
```

---

## Verification Checklist

After setup, verify each service works:

- [ ] `gcloud projects list` shows your project
- [ ] `gsutil ls gs://your-bucket-name/` returns (empty or with files)
- [ ] Cloud Run URL opens the upload interface
- [ ] Uploading a text file + prompt starts the cinematic experience
- [ ] Images appear (Gemini image generation working)
- [ ] Audio plays (Cloud TTS working)
- [ ] Firestore console shows session documents

---

## Troubleshooting

### "GEMINI_API_KEY is not set"
→ Make sure `.env` is in the `backend/` directory and the key is correct.

### "Permission denied" on Cloud Storage
→ Run the `gcloud projects add-iam-policy-binding` command from Step 6 again.

### Images not generating
→ Gemini 2.0 Flash image generation (`gemini-2.0-flash-exp-image-generation`) may have quota limits. Check: https://aistudio.google.com/app/quotas

### Audio not playing in browser
→ Browsers block autoplay. Click the "Replay Audio" button that appears in the top-right corner.

### Cloud Run timeout
→ The `--timeout 3600` flag allows up to 1 hour. For very large files, this may need increasing.

### "Default credentials not found"
→ Either set `GOOGLE_APPLICATION_CREDENTIALS` to your key file path, or run:
```bash
gcloud auth application-default login
```

---

## Cost Estimate (Hackathon Usage)

| Service | Free Tier | Typical Hackathon Cost |
|---|---|---|
| Cloud Run | 2M requests/month free | ~$0 |
| Cloud Storage | 5GB free | ~$0 |
| Firestore | 1GB storage free | ~$0 |
| Cloud TTS | 1M chars/month free (Neural2: 1M chars) | ~$0–$2 |
| Gemini API | Varies by key type | Check AI Studio |

Total expected cost for hackathon: **$0–$5**
