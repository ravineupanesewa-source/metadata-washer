import { ImageResponse } from "next/og";
import { SITE } from "@/lib/config/site";

export const alt = `${SITE.name}: remove EXIF and image metadata without recompressing`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card, rendered once at build time. Uses next/og's bundled font (no network). */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: 80,
          background: "radial-gradient(circle at 25% 40%, #1a1433 0%, #08090c 60%)",
          color: "#ffffff",
        }}
      >
        {/* Washer porthole */}
        <div
          style={{
            width: 300,
            height: 300,
            flexShrink: 0,
            borderRadius: 9999,
            border: "18px solid #9d8cff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#14161b",
            boxShadow: "0 0 120px rgba(157,140,255,0.35)",
          }}
        >
          <div
            style={{
              width: 170,
              height: 170,
              borderRadius: 9999,
              background: "radial-gradient(circle at 35% 30%, #3a5560, #0d1418 70%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Checkmark drawn with borders: the bundled font has no ✓ glyph (and builds stay offline). */}
            <div
              style={{
                width: 44,
                height: 84,
                marginTop: -18,
                borderRight: "16px solid #5ce1e6",
                borderBottom: "16px solid #5ce1e6",
                transform: "rotate(45deg)",
              }}
            />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 34, color: "#9d8cff", letterSpacing: 6, textTransform: "uppercase" }}>{SITE.name}</div>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>Remove image metadata.</div>
          <div style={{ fontSize: 30, color: "rgba(255,255,255,0.7)", lineHeight: 1.4 }}>
            Strip GPS, camera and author data from your photos. No recompression. Nothing stored.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
