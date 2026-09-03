import { ImageResponse } from "next/og";

export function generateImageMetadata() {
  return [
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const key = await id;
  const n = Number(key);
  const fontSize = n <= 32 ? 22 : Math.round(n * 0.58);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#16301c",
          color: "#c8ecc8",
          fontSize,
          fontWeight: 700,
          letterSpacing: n <= 32 ? -1 : -6,
          borderRadius: n <= 32 ? 6 : 0,
        }}
      >
        Đ
      </div>
    ),
    { width: n, height: n }
  );
}
