/**
 * Plain deep-link builders for Call/Waze/Google Maps buttons — no API keys,
 * no paid Maps API (hard project requirement). Pure functions used from
 * both Server Components and Client Components, so this file deliberately
 * does NOT import "server-only".
 */

/** "tel:" + phone with only a leading "+" and digits kept. */
export function buildTelHref(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return `tel:${hasPlus ? "+" : ""}${digits}`;
}

interface LocationInput {
  latitude?: string | null;
  longitude?: string | null;
  address?: string | null;
}

/** A Waze navigation deep link, preferring coordinates over a text address. */
export function buildWazeUrl(input: LocationInput): string | null {
  if (input.latitude && input.longitude) {
    return `https://waze.com/ul?ll=${input.latitude}%2C${input.longitude}&navigate=yes`;
  }
  if (input.address) {
    return `https://waze.com/ul?q=${encodeURIComponent(input.address)}&navigate=yes`;
  }
  return null;
}

interface GoogleMapsLocationInput extends LocationInput {
  googleMapsUrl?: string | null;
}

/**
 * A Google Maps link — prefers an explicit stored link (customers.google_
 * maps_url, section 9), then coordinates, then a text address search.
 */
export function buildGoogleMapsUrl(
  input: GoogleMapsLocationInput,
): string | null {
  if (input.googleMapsUrl) return input.googleMapsUrl;
  if (input.latitude && input.longitude) {
    return `https://www.google.com/maps/search/?api=1&query=${input.latitude},${input.longitude}`;
  }
  if (input.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(input.address)}`;
  }
  return null;
}
