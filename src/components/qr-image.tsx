import "server-only";
import { drawQr } from "@/lib/qr-svg";

/** QR code vetorial (nítido em qualquer tamanho de impressão). Renderizado no servidor. */
export function QrImage({
  value,
  label,
  className,
  style,
}: {
  value: string;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { size, path } = drawQr(value);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={style}
      role="img"
      aria-label={label ?? value}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
