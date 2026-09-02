import { Phone, Navigation, MapPin } from "lucide-react";
import { buildTelHref, buildWazeUrl, buildGoogleMapsUrl } from "@/lib/location-links";
import { Button } from "@/components/ui/button";

interface LocationButtonsProps {
  phone?: string | null;
  address?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  googleMapsUrl?: string | null;
  /** Button size — "default" (44px) for one-handed, in-the-field screens
   * like My Day; "sm" (36px) elsewhere. Defaults to "sm". */
  size?: "sm" | "default";
}

/**
 * A row of Call/Waze/Google Maps buttons, built from plain deep links (no
 * paid Maps API — see src/lib/location-links.ts). Each button renders only
 * if its underlying link resolves; if none do, this renders nothing at all
 * rather than an empty wrapper.
 */
export function LocationButtons({
  phone,
  address,
  latitude,
  longitude,
  googleMapsUrl,
  size = "sm",
}: LocationButtonsProps) {
  const telHref = phone ? buildTelHref(phone) : null;
  const wazeUrl = buildWazeUrl({ latitude, longitude, address });
  const mapsUrl = buildGoogleMapsUrl({ latitude, longitude, address, googleMapsUrl });

  if (!telHref && !wazeUrl && !mapsUrl) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {telHref && (
        <Button size={size} variant="outline" asChild>
          <a href={telHref}>
            <Phone className="size-4" />
            اتصال
          </a>
        </Button>
      )}
      {wazeUrl && (
        <Button size={size} variant="outline" asChild>
          <a href={wazeUrl} target="_blank" rel="noopener noreferrer">
            <Navigation className="size-4" />
            Waze
          </a>
        </Button>
      )}
      {mapsUrl && (
        <Button size={size} variant="outline" asChild>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <MapPin className="size-4" />
            خرائط جوجل
          </a>
        </Button>
      )}
    </div>
  );
}
