"use client";

import * as React from "react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

interface SignaturePadProps {
  /** Called with a trimmed PNG data URL once there's a stroke on the pad,
   * or null once cleared / while empty. */
  onChange: (dataUrl: string | null) => void;
}

/**
 * Wraps react-signature-canvas (section 18's e-signature capture). The
 * underlying <canvas> needs real pixel dimensions (CSS scaling would blur
 * strokes and desync touch coordinates), so this measures its wrapper on
 * mount/resize instead of using a fixed size — mobile-first (section 1)
 * means this has to work from a ~320px phone screen up to desktop.
 */
export function SignaturePad({ onChange }: SignaturePadProps) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const padRef = React.useRef<SignatureCanvas>(null);
  // Starts unmeasured (null), not a guessed default: react-signature-canvas
  // initializes its underlying signature_pad instance once, against
  // whatever canvas size it first mounts with, and does not appear to
  // correctly reinitialize that instance's internal coordinate scaling if
  // canvasProps' width/height change on a later re-render of the SAME
  // instance (drawing silently stops registering — verified while testing
  // the public signing flow end to end). So instead of mounting once at a
  // guessed size and resizing in place, this waits for the real
  // measurement and then mounts <SignatureCanvas> fresh (via the `key`
  // below) exactly once at its final size.
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);

  React.useLayoutEffect(() => {
    function measure() {
      const width = wrapperRef.current?.clientWidth ?? 320;
      setSize({ width, height: Math.round(width * 0.45) });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function handleEnd() {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      onChange(null);
      return;
    }
    onChange(pad.getTrimmedCanvas().toDataURL("image/png"));
  }

  function handleClear() {
    padRef.current?.clear();
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <div ref={wrapperRef} className="w-full rounded-lg border-2 border-dashed bg-muted/30">
        {size && (
          <SignatureCanvas
            key={`${size.width}x${size.height}`}
            ref={padRef}
            penColor="#1a3c6e"
            canvasProps={{
              width: size.width,
              height: size.height,
              className: "touch-none rounded-lg",
            }}
            onEnd={handleEnd}
          />
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={handleClear}>
        <Eraser className="size-4" />
        مسح التوقيع
      </Button>
    </div>
  );
}
