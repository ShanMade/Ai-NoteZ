import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.shanmade.notez",
  appName: "Notez",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
