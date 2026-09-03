import { describe, it, expect } from "vitest";
import {
  isAllowedAttachmentMimeType,
  validateAttachmentFiles,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ATTACHMENTS_PER_SUBMISSION,
} from "@/server/storage/attachments";

/**
 * New Measurement quick-submit flow (docs/superpowers/specs/
 * 2026-09-03-new-measurement-quick-submit-design.md section 9) — the
 * server-side file allowlist/limits, which are the authoritative check
 * (the client-side mirror in new-measurement-form.tsx is fast-feedback
 * only, never trusted). saveMeasurementAttachment/resolveAttachmentAbsolutePath/
 * readMeasurementAttachment are deliberately NOT unit-tested here — they
 * touch the real filesystem under storage/measurement-attachments/, so
 * exercising them meaningfully belongs to the Playwright suite (which
 * drives a real submission end to end and reads the resulting rows/bytes
 * back), not a DB/FS-free unit test.
 */

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe("isAllowedAttachmentMimeType", () => {
  it("accepts every allowed raster image type", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/heic",
      "image/heif",
      "image/bmp",
    ]) {
      expect(isAllowedAttachmentMimeType(type)).toBe(true);
    }
  });

  it("accepts application/pdf", () => {
    expect(isAllowedAttachmentMimeType("application/pdf")).toBe(true);
  });

  // Regression lock for the security fix that just landed: image/svg+xml
  // is a script-capable XML document, not a pixel format. The attachment
  // retrieval route serves files back with Content-Disposition: inline and
  // the stored (client-declared, unsniffed) MIME type, so accepting SVG
  // here would let a CREATE_MEASUREMENT holder upload a <script>-bearing
  // "photo" that executes in the app's own origin under the session of
  // whoever later opens it. Must never regress back to a blanket
  // `type.startsWith("image/")` check.
  it("rejects image/svg+xml even though it starts with 'image/' (security fix regression test)", () => {
    expect(isAllowedAttachmentMimeType("image/svg+xml")).toBe(false);
  });

  it("rejects other image types not on the explicit raster allowlist", () => {
    expect(isAllowedAttachmentMimeType("image/tiff")).toBe(false);
    expect(isAllowedAttachmentMimeType("image/x-icon")).toBe(false);
  });

  it("rejects non-image, non-pdf types", () => {
    expect(isAllowedAttachmentMimeType("text/plain")).toBe(false);
    expect(isAllowedAttachmentMimeType("application/octet-stream")).toBe(false);
    expect(isAllowedAttachmentMimeType("application/x-msdownload")).toBe(false);
    expect(isAllowedAttachmentMimeType("text/html")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isAllowedAttachmentMimeType("")).toBe(false);
  });
});

describe("validateAttachmentFiles", () => {
  it("returns null (accepts) for a single ordinary allowed file within limits", () => {
    const file = makeFile("photo.png", "image/png", 1024);
    expect(validateAttachmentFiles([file])).toBeNull();
  });

  it("returns null for a full batch (exactly MAX_ATTACHMENTS_PER_SUBMISSION) of mixed allowed types", () => {
    const files = [
      makeFile("a.jpg", "image/jpeg", 1024),
      makeFile("b.png", "image/png", 1024),
      makeFile("c.pdf", "application/pdf", 1024),
      makeFile("d.webp", "image/webp", 1024),
      makeFile("e.heic", "image/heic", 1024),
    ];
    expect(files.length).toBe(MAX_ATTACHMENTS_PER_SUBMISSION);
    expect(validateAttachmentFiles(files)).toBeNull();
  });

  it("does not enforce a minimum — an empty array is accepted (the 'at least one file' rule is the submit flow's own business rule, not this generic validator's)", () => {
    expect(validateAttachmentFiles([])).toBeNull();
  });

  it("rejects a batch exceeding MAX_ATTACHMENTS_PER_SUBMISSION, naming the limit", () => {
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_SUBMISSION + 1 }, (_, i) =>
      makeFile(`f${i}.png`, "image/png", 1024),
    );
    const error = validateAttachmentFiles(files);
    expect(error).not.toBeNull();
    expect(error).toContain(String(MAX_ATTACHMENTS_PER_SUBMISSION));
  });

  it("rejects a disallowed MIME type, naming the offending file", () => {
    const file = makeFile("payload.svg", "image/svg+xml", 1024);
    const error = validateAttachmentFiles([file]);
    expect(error).not.toBeNull();
    expect(error).toContain("payload.svg");
    expect(error).toContain("غير مدعوم");
  });

  it("rejects the first disallowed file in a batch even when earlier files are fine", () => {
    const files = [
      makeFile("ok.png", "image/png", 1024),
      makeFile("bad.exe", "application/x-msdownload", 1024),
    ];
    const error = validateAttachmentFiles(files);
    expect(error).toContain("bad.exe");
  });

  it("accepts a file exactly at MAX_ATTACHMENT_SIZE_BYTES (boundary)", () => {
    const file = makeFile("big.png", "image/png", MAX_ATTACHMENT_SIZE_BYTES);
    expect(validateAttachmentFiles([file])).toBeNull();
  });

  it("rejects a file one byte over MAX_ATTACHMENT_SIZE_BYTES, naming the limit in megabytes", () => {
    const file = makeFile("toobig.png", "image/png", MAX_ATTACHMENT_SIZE_BYTES + 1);
    const error = validateAttachmentFiles([file]);
    expect(error).not.toBeNull();
    expect(error).toContain("toobig.png");
    expect(error).toContain("15");
  });

  it("rejects a zero-byte (empty) file", () => {
    const file = makeFile("empty.png", "image/png", 0);
    const error = validateAttachmentFiles([file]);
    expect(error).not.toBeNull();
    expect(error).toContain("فارغ");
  });

  it("checks type/size for every file, not just the first (a later file's violation is still caught)", () => {
    const files = [
      makeFile("ok1.png", "image/png", 1024),
      makeFile("ok2.pdf", "application/pdf", 1024),
      makeFile("bad3.svg", "image/svg+xml", 1024),
    ];
    const error = validateAttachmentFiles(files);
    expect(error).toContain("bad3.svg");
  });
});
