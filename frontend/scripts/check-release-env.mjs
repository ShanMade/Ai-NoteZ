import { loadEnv } from "vite";

const env = { ...loadEnv("production", process.cwd(), ""), ...process.env };
const required = [
  "VITE_API_URL",
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
];
const missing = required.filter((key) => !env[key]?.trim());
if (missing.length) {
  console.error(`Production configuration is incomplete. Set: ${missing.join(", ")}`);
  process.exit(1);
}

let apiUrl;
try {
  apiUrl = new URL(env.VITE_API_URL);
} catch {
  console.error("VITE_API_URL must be an absolute HTTPS URL.");
  process.exit(1);
}
if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
  console.error("VITE_API_URL must use HTTPS and must not contain credentials, a query, or a fragment.");
  process.exit(1);
}

let authDomain;
try {
  authDomain = new URL(`https://${env.VITE_FIREBASE_AUTH_DOMAIN}`);
} catch {
  console.error("VITE_FIREBASE_AUTH_DOMAIN must be a hostname.");
  process.exit(1);
}
if (
  authDomain.hostname !== env.VITE_FIREBASE_AUTH_DOMAIN
  || authDomain.username
  || authDomain.password
  || authDomain.port
  || authDomain.pathname !== "/"
  || authDomain.search
  || authDomain.hash
) {
  console.error("VITE_FIREBASE_AUTH_DOMAIN must be a hostname without a scheme, path, or port.");
  process.exit(1);
}

const invalidValues = required.filter((key) => /replace[-_ ]?me|your[-_ ]|example\.invalid|<|>|\s/i.test(env[key]));
if (invalidValues.length) {
  console.error(`Replace placeholder production values: ${invalidValues.join(", ")}`);
  process.exit(1);
}

console.log("Production configuration is present and uses HTTPS. Firebase web settings are public config, not backend secrets.");
