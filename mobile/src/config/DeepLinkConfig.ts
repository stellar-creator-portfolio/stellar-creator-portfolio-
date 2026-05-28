/**
 * DeepLinkConfig — Issue #543
 * "Configure standard Deep-Linking logic enabling URL interceptions globally"
 *
 * Defines:
 *  - URL scheme + universal link prefixes
 *  - Route-to-screen mapping (linking config for react-navigation)
 *  - Deep-link parser utility
 *  - Incoming URL handler (initial URL + subscription)
 *
 * Supported deep-link patterns:
 *   stellar://creator/:id          → CreatorProfile screen
 *   stellar://freelancers          → FreelancerDirectory screen
 *   stellar://freelancers/:id      → CreatorProfile screen (freelancer view)
 *   stellar://dashboard            → Dashboard screen
 *   stellar://messages/:id         → Messaging screen
 *   stellar://upload               → ImagePicker screen
 *
 * Universal links (HTTPS):
 *   https://stellar.app/creator/:id
 *   https://stellar.app/freelancers
 *   https://stellar.app/dashboard
 *   https://stellar.app/messages/:id
 *   https://stellar.app/upload
 */

import { Linking } from "react-native";
import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "../types";

// ─── URL prefixes ─────────────────────────────────────────────────────────────

export const DEEP_LINK_PREFIXES = [
  "stellar://",
  "https://stellar.app",
  "https://www.stellar.app",
] as const;

// ─── Route path map ───────────────────────────────────────────────────────────

/**
 * Maps react-navigation screen names to URL path patterns.
 * Nested navigators use the dot notation: "MainTabs/Profile".
 */
export const DEEP_LINK_CONFIG: LinkingOptions<RootStackParamList>["config"] = {
  screens: {
    MainTabs: {
      screens: {
        Home: "",
        Dashboard: "dashboard",
        Profile: "profile",
        Activity: "activity",
        Settings: "settings",
      },
    },
    Dashboard: "dashboard/:period?",
    LanguageSettings: "settings/language",
    // Extended screens (added by issues #542–#545)
    CreatorProfile: "creator/:creatorId",
    FreelancerDirectory: "freelancers",
    FreelancerProfile: "freelancers/:creatorId",
    Messaging: "messages/:conversationId",
    ImagePicker: "upload",
  } as any, // cast needed until extended param list is added
};

// ─── Full linking options object ──────────────────────────────────────────────

/**
 * Pass this directly to <NavigationContainer linking={...} />.
 *
 * Example:
 *   import { LINKING_OPTIONS } from '../config/DeepLinkConfig';
 *   <NavigationContainer linking={LINKING_OPTIONS} ...>
 */
export const LINKING_OPTIONS: LinkingOptions<RootStackParamList> = {
  prefixes: [...DEEP_LINK_PREFIXES],
  config: DEEP_LINK_CONFIG,

  /**
   * Custom getInitialURL — handles cold-start deep links.
   * Falls back to Linking.getInitialURL() which covers both
   * custom schemes and universal links.
   */
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    return url ?? undefined;
  },

  /**
   * Custom subscribe — handles warm/hot-start deep links.
   * Returns an unsubscribe function as required by react-navigation.
   */
  subscribe(listener) {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      listener(url);
    });
    return () => subscription.remove();
  },
};

// ─── Parsed deep-link type ────────────────────────────────────────────────────

export type DeepLinkRoute =
  | { screen: "Home" }
  | { screen: "Dashboard"; params?: { period?: string } }
  | { screen: "CreatorProfile"; params: { creatorId: string } }
  | { screen: "FreelancerDirectory" }
  | { screen: "FreelancerProfile"; params: { creatorId: string } }
  | { screen: "Messaging"; params: { conversationId: string } }
  | { screen: "ImagePicker" }
  | { screen: "LanguageSettings" }
  | { screen: "Unknown"; url: string };

// ─── URL parser ───────────────────────────────────────────────────────────────

/**
 * Parses a raw deep-link URL into a typed route descriptor.
 * Handles both custom scheme (stellar://) and universal links (https://stellar.app).
 *
 * @example
 *   parseDeepLink('stellar://creator/alex-studio')
 *   // → { screen: 'CreatorProfile', params: { creatorId: 'alex-studio' } }
 *
 *   parseDeepLink('https://stellar.app/freelancers')
 *   // → { screen: 'FreelancerDirectory' }
 */
export function parseDeepLink(url: string): DeepLinkRoute {
  // Normalise: strip scheme + host to get the path
  let path = url;

  for (const prefix of DEEP_LINK_PREFIXES) {
    if (url.startsWith(prefix)) {
      path = url.slice(prefix.length);
      break;
    }
  }

  // Strip leading slash and query string
  path = path.replace(/^\/+/, "").split("?")[0].split("#")[0];

  const segments = path.split("/").filter(Boolean);
  const [first, second] = segments;

  switch (first) {
    case undefined:
    case "":
      return { screen: "Home" };

    case "dashboard":
      return {
        screen: "Dashboard",
        params: second ? { period: second } : undefined,
      };

    case "creator":
      if (second)
        return { screen: "CreatorProfile", params: { creatorId: second } };
      return { screen: "FreelancerDirectory" };

    case "freelancers":
      if (second)
        return { screen: "FreelancerProfile", params: { creatorId: second } };
      return { screen: "FreelancerDirectory" };

    case "messages":
      if (second)
        return { screen: "Messaging", params: { conversationId: second } };
      return { screen: "Home" };

    case "upload":
      return { screen: "ImagePicker" };

    case "settings":
      if (second === "language") return { screen: "LanguageSettings" };
      return { screen: "Home" };

    case "profile":
    case "activity":
    case "home":
      return { screen: "Home" };

    default:
      return { screen: "Unknown", url };
  }
}

// ─── Deep-link handler hook ───────────────────────────────────────────────────

/**
 * useDeepLinkHandler — subscribes to incoming deep links and calls
 * the provided handler with a parsed DeepLinkRoute.
 *
 * Usage:
 *   useDeepLinkHandler((route) => {
 *     if (route.screen === 'CreatorProfile') {
 *       navigation.navigate('CreatorProfile', route.params);
 *     }
 *   });
 */
import { useEffect } from "react";

export function useDeepLinkHandler(
  handler: (route: DeepLinkRoute) => void,
): void {
  useEffect(() => {
    // Handle cold-start URL
    Linking.getInitialURL().then((url) => {
      if (url) handler(parseDeepLink(url));
    });

    // Handle warm/hot-start URLs
    const subscription = Linking.addEventListener("url", ({ url }) => {
      handler(parseDeepLink(url));
    });

    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ─── URL builder ──────────────────────────────────────────────────────────────

/**
 * Builds a deep-link URL for sharing or programmatic navigation.
 *
 * @example
 *   buildDeepLink('creator', 'alex-studio')
 *   // → 'stellar://creator/alex-studio'
 */
export function buildDeepLink(...segments: string[]): string {
  return `stellar://${segments.filter(Boolean).join("/")}`;
}

/**
 * Builds a universal (HTTPS) link for sharing outside the app.
 *
 * @example
 *   buildUniversalLink('creator', 'alex-studio')
 *   // → 'https://stellar.app/creator/alex-studio'
 */
export function buildUniversalLink(...segments: string[]): string {
  return `https://stellar.app/${segments.filter(Boolean).join("/")}`;
}
