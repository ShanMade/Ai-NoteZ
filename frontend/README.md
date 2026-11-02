# Notez frontend

The root route (`/`) is the authenticated, API-backed workspace. Sign in with Google or an email
and password, create an account, or continue as a guest. When Firebase is not configured, guest
access opens the sample workspace; it does not create an authenticated account or connect to the
backend. Private workspace and design-exploration routes require authentication or the guest action.
Shared-note links remain public. The responsive recording flow is available from a note or at
`/record/:noteId`; the AI panel is docked on desktop and opens as a bottom sheet on mobile.
Workspace pages and sidebars scroll independently inside a fixed app frame, route changes reset page
scroll, and scrollbars are visually hidden while native scrolling remains available.

## Run locally

```powershell
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and provide the backend URL and Firebase Web App settings.
Enable Google, Email/Password, and Anonymous providers in Firebase Authentication. Signing in or
creating an account from a guest session links the guest identity with Firebase's account-linking
flow, preserving that user's notes. Username-only sign-in requires a server-side username-to-email
mapping and is not supported by this Firebase setup.

The library uses the backend `/v1/notes` API and expects Firebase ID tokens. Shared notes are loaded
from their public endpoint without sending an Authorization header. The TipTap editor stores
Markdown, supports headings, lists, code blocks, inline/block maths, slash commands, and `[[note]]`
autocomplete; Ctrl/Cmd-click a reference to open its matching note. Its writing surface uses
automatic text direction so mixed English and Urdu content follows what was typed.

English, Urdu, and Hindi UI strings are provided. Urdu switches the document to RTL and uses Noto
Nastaliq Urdu as its glyph fallback, loaded from Google Fonts.

## Offline behavior

The app caches a user's note list in IndexedDB and stores offline creates, edits, and deletes in an
owner-scoped ordered queue. Changes sync when the workspace opens or connectivity returns. A
version conflict pauses the queue and presents both versions; choosing a side resumes the queue.
The last completed delta cursor is stored locally per account on this device. Use a configured
backend and Firebase project to exercise online CRUD and multi-device conflict flows.

## Android

The Capacitor Android project lives in `android/`. Capacitor and the voice-recorder plugin are
registered, and the Android manifest requests microphone access. Run `npm run android:sync` to
build the web app and sync native assets, then open the project with `npm run android:open`.
Building an APK requires a JDK and Android SDK/Android Studio.

The Agent 2 recorder still uses its segmented `MediaRecorder` pipeline. The voice-recorder plugin
returns a single recording rather than the pipeline's timed upload parts, so replacing that engine
needs a coordinated adapter rather than silently changing the recording format.

## Production web release

The Vite app is deployed separately from the legacy static app in the repository root. Its Firebase
Hosting config serves only `frontend/dist`, rewrites client routes to `index.html`, and targets a
dedicated Hosting site named `notez-frontend`; it will not overwrite the root app's Hosting site.

1. Copy `env.production.example` to `.env.production` and fill in the Firebase Web App settings and
   HTTPS URL of the deployed v2 API. These `VITE_*` values are included in browser code. Firebase
   web config is public configuration, not a place for Admin keys or provider secrets.
2. Create a separate Firebase Hosting site for this app. Copy `.firebaserc.example` to
   `.firebaserc`, replace the project and new site IDs, then run:

   ```powershell
   npm ci
   firebase hosting:sites:create <new-unique-site-id> --project <firebase-project-id>
   firebase target:apply hosting notez-frontend <new-unique-site-id> --project <firebase-project-id>
   npm run build:release
   firebase deploy --only hosting:notez-frontend --project <firebase-project-id>
   ```

   Do not point `notez-frontend` at the existing root Hosting site unless replacing that app is
   explicitly intended. Add the new Hosting domain to Firebase Authentication's authorized domains.
   Set the deployed origin in the backend's exact CORS allowlist and as `PUBLIC_FRONTEND_URL`.
3. Configure the backend environment in its host's secret manager. Required infrastructure includes
   PostgreSQL, Redis, Firebase Admin service-account JSON, and exact CORS origins. Managed AI,
   semantic retrieval, and reliable recording additionally require Gemini, Qdrant, and shared
   persistent audio storage (for example R2). Run Alembic migrations as a release step, and run the
   API, Celery worker, and Celery Beat as separate processes. See [the backend deployment guide](../backend/README.md).

`npm run build:release` refuses to build unless all Firebase web settings and an HTTPS API URL are
present and non-placeholder. Never place service-account JSON, AI provider keys, database passwords,
or Redis credentials in `.env.production`, `VITE_*` variables, or browser code. Do not send private
deployment credentials in chat; enter them directly into the hosting provider's secret manager.

## Backend-dependent work

The current backend does not expose a note-attachment signed-upload endpoint, attachment metadata
fields, or account-deletion endpoint. Attachment upload and permanent account deletion remain
unavailable until those API contracts exist. Account export is available from Settings.
