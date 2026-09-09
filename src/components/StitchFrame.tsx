import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { stitchSrc } from "../screens";

type Props = {
  folder: string;
  title?: string;
  /** Скрыть встроенный сайдбар/топбар экрана — используется эталонный shell */
  inShell?: boolean;
  bridgePayload?: unknown;
  onBridgeMessage?: (data: unknown) => void;
};

export function StitchFrame({
  folder,
  title,
  inShell = false,
  bridgePayload,
  onBridgeMessage,
}: Props) {
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.title = title ? `${title} · SVODKA` : "SVODKA";
  }, [title]);

  useEffect(() => {
    setReady(false);
  }, [folder, inShell]);

  useEffect(() => {
    if (!ready || bridgePayload === undefined) return;
    iframeRef.current?.contentWindow?.postMessage(bridgePayload, "*");
  }, [bridgePayload, ready]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type === "svodka:navigate") {
        const to = String(event.data.to || "");
        if (!to.startsWith("/")) return;
        navigate(to);
        return;
      }
      onBridgeMessage?.(event.data);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate, onBridgeMessage]);

  const src = inShell ? `${stitchSrc(folder)}?shell=1` : stitchSrc(folder);

  return (
    <iframe
      ref={iframeRef}
      title={title ?? folder}
      src={src}
      className={`stitch-frame${ready ? " is-ready" : ""}`}
      onLoad={() => {
        setReady(true);
      }}
    />
  );
}
