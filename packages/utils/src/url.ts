import LinkifyIt from 'linkify-it';
import tlds from 'tlds';

import { IENV, getEnv } from './env';
import { getRuntime } from './env';

const overrideLocalDev = false;

export const EXTENSION_DOWNLOAD_LINK =
  'https://chromewebstore.google.com/detail/lecbjbapfkinmikhadakbclblnemmjpd';

export const SERVER_PROD_DOMAIN = 'https://api.refly.ai';
export const SERVER_DEV_DOMAIN = 'http://localhost:5800';

export const CLIENT_PROD_APP_DOMAIN = 'https://refly.ai';
export const CLIENT_DEV_APP_DOMAIN = 'http://localhost:5173';

export const CLIENT_DEV_COOKIE_DOMAIN = 'http://localhost:3000';
export const CLIENT_PROD_COOKIE_DOMAIN = '.refly.ai';

export const getExtensionId = () => {
  if (overrideLocalDev) {
    return 'lecbjbapfkinmikhadakbclblnemmjpd';
  }

  return getEnv() === IENV.DEVELOPMENT
    ? 'lecbjbapfkinmikhadakbclblnemmjpd'
    : 'lecbjbapfkinmikhadakbclblnemmjpd';
};

export const getExtensionServerOrigin = () => {
  if (overrideLocalDev) {
    return CLIENT_DEV_COOKIE_DOMAIN;
  }

  return getEnv() === IENV.DEVELOPMENT ? SERVER_DEV_DOMAIN : SERVER_PROD_DOMAIN;
};

export const getClientOrigin = () => {
  // Check if we're in extension background
  const runtime = getRuntime();
  if (runtime === 'extension-background') {
    return getEnv() === IENV.DEVELOPMENT ? CLIENT_DEV_APP_DOMAIN : CLIENT_PROD_APP_DOMAIN;
  }

  if (overrideLocalDev) {
    return CLIENT_DEV_APP_DOMAIN;
  }

  return getEnv() === IENV.DEVELOPMENT ? CLIENT_DEV_APP_DOMAIN : CLIENT_PROD_APP_DOMAIN;
};

export function safeParseURL(url: string) {
  try {
    const urlObj = new URL(url);

    return urlObj?.origin;
  } catch (_err) {
    return url || '';
  }
}

// Initialize linkify-it with all TLDs
const linkify = new LinkifyIt();
// Add all top-level domains and enable fuzzy IP detection
linkify.tlds(tlds).set({ fuzzyIP: true, fuzzyLink: true });

/**
 * Validates URL using built-in Node.js URL class
 * @param url The URL string to validate
 * @returns Boolean indicating if the URL is valid
 */
export function isValidUrl(url: string): boolean {
  try {
    // Check if URL can be constructed (validates format)
    new URL(url);
    return true;
  } catch {
    // Invalid URL format
    return false;
  }
}

/**
 * Extract URLs using regex for common URL patterns
 * This is a fallback method when linkify-it fails
 * @param text The text to extract URLs from
 * @returns Array of extracted URLs
 */
function extractUrlsWithRegex(text: string): string[] {
  // Updated regex to match more URL protocols (http, https, ftp, ftps, etc.)
  const urlRegex = /((?:https?|ftp|ftps|file|ssh|sftp|mailto|tel|data):\/\/[^\s<>[\]"'()\{\}]+)/gi;
  const matches = text.match(urlRegex);
  return matches?.map((url) => url.trim()) || [];
}

/**
 * Extract URLs from text using linkify-it
 * Much faster and more reliable than regex or AI-based extraction
 * @param query The text to extract URLs from
 * @returns Object with detected URLs and whether URLs were found
 */
export function extractUrlsWithLinkify(query: string): {
  hasUrls: boolean;
  detectedUrls: string[];
} {
  if (!query) {
    return { hasUrls: false, detectedUrls: [] };
  }

  // Find all links in text
  const matches = linkify.match(query);

  let detectedUrls: string[] = [];

  // If linkify found matches, process them
  if (matches && matches.length > 0) {
    detectedUrls = matches
      .map((match) => {
        // Get the raw URL
        let url = match.url;

        // If schema is missing, add https://
        if (!match.schema) {
          url = `https://${url}`;
        }

        // Check if the original URL in the query had a trailing slash
        // We need to use the match indices to extract the exact original string
        const originalUrlText = query.substring(match.index, match.lastIndex);
        const hasTrailingSlash = originalUrlText.endsWith('/');

        // Add trailing slash if it was in the original URL but got removed
        if (hasTrailingSlash && !url.endsWith('/')) {
          url = `${url}/`;
        }

        return url;
      })
      .filter(isValidUrl); // Filter out any URLs that aren't valid
  }

  // If linkify didn't find any URLs or found fewer than expected, try regex as fallback
  if (detectedUrls.length === 0) {
    const regexUrls = extractUrlsWithRegex(query);
    detectedUrls = [...new Set([...detectedUrls, ...regexUrls])].filter(isValidUrl);
  }

  return {
    hasUrls: detectedUrls.length > 0,
    detectedUrls,
  };
}
