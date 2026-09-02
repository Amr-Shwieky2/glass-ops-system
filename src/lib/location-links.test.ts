import { describe, it, expect } from "vitest";
import { buildTelHref, buildWazeUrl, buildGoogleMapsUrl } from "@/lib/location-links";

describe("buildTelHref", () => {
  it("keeps a leading + and strips everything but digits", () => {
    expect(buildTelHref("+972-50-123-4567")).toBe("tel:+972501234567");
  });

  it("strips formatting from a local number with no country code", () => {
    expect(buildTelHref("050-123-4567")).toBe("tel:0501234567");
  });

  it("strips spaces and parentheses", () => {
    expect(buildTelHref("(050) 123 4567")).toBe("tel:0501234567");
  });

  it("trims surrounding whitespace before checking for a leading +", () => {
    expect(buildTelHref("  +972501234567  ")).toBe("tel:+972501234567");
  });

  it("drops a + that isn't the very first character", () => {
    expect(buildTelHref("050+1234567")).toBe("tel:0501234567");
  });

  it("produces tel: with no digits for a string with none", () => {
    expect(buildTelHref("abc")).toBe("tel:");
  });
});

describe("buildWazeUrl", () => {
  it("prefers coordinates over an address when both are present", () => {
    const url = buildWazeUrl({ latitude: "32.0853", longitude: "34.7818", address: "Tel Aviv" });
    expect(url).toBe("https://waze.com/ul?ll=32.0853%2C34.7818&navigate=yes");
  });

  it("falls back to an address search when there are no coordinates", () => {
    const url = buildWazeUrl({ address: "شارع الملك فيصل, حيفا" });
    expect(url).toBe(
      `https://waze.com/ul?q=${encodeURIComponent("شارع الملك فيصل, حيفا")}&navigate=yes`,
    );
  });

  it("returns null when both latitude/longitude and address are absent", () => {
    expect(buildWazeUrl({})).toBeNull();
    expect(buildWazeUrl({ latitude: null, longitude: null, address: null })).toBeNull();
  });

  it("requires BOTH latitude and longitude, not just one", () => {
    expect(buildWazeUrl({ latitude: "32.0853", address: "Tel Aviv" })).toBe(
      `https://waze.com/ul?q=${encodeURIComponent("Tel Aviv")}&navigate=yes`,
    );
  });
});

describe("buildGoogleMapsUrl", () => {
  it("prefers an explicitly stored googleMapsUrl over everything else", () => {
    const url = buildGoogleMapsUrl({
      googleMapsUrl: "https://maps.app.goo.gl/abc123",
      latitude: "32.0853",
      longitude: "34.7818",
      address: "Tel Aviv",
    });
    expect(url).toBe("https://maps.app.goo.gl/abc123");
  });

  it("falls back to coordinates when there is no stored link", () => {
    const url = buildGoogleMapsUrl({ latitude: "32.0853", longitude: "34.7818" });
    expect(url).toBe("https://www.google.com/maps/search/?api=1&query=32.0853,34.7818");
  });

  it("falls back to an address search when there is no link or coordinates", () => {
    const url = buildGoogleMapsUrl({ address: "حيفا" });
    expect(url).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("حيفا")}`,
    );
  });

  it("returns null when nothing is available", () => {
    expect(buildGoogleMapsUrl({})).toBeNull();
    expect(
      buildGoogleMapsUrl({ googleMapsUrl: null, latitude: null, longitude: null, address: null }),
    ).toBeNull();
  });
});
