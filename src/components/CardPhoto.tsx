import { useEffect, useRef } from "react";
import { isOwnStorageUrl } from "../lib/imageLoad";
import { watchImage, BLANK_IMG } from "../lib/imageGate";
import { onImgError } from "../util";

/**
 * A gallery photo. Photos in our own storage wait for a turn in the shared
 * image gate (see lib/imageGate.ts) so scrolling a long list can't fire
 * hundreds of requests at once; anything else is a plain lazy <img>.
 */
export default function CardPhoto({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const own = isOwnStorageUrl(src);
  useEffect(() => {
    if (!own || !ref.current) return;
    return watchImage(ref.current, src);
  }, [own, src]);
  if (!own) return <img src={src} alt={alt} loading="lazy" onError={onImgError} />;
  return <img ref={ref} src={BLANK_IMG} alt={alt} />;
}
