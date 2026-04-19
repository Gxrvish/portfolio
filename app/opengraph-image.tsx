import { ImageResponse } from "next/og";

export const size = {
    width: 1200,
    height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
    return new ImageResponse(
        <div
            style={{
                height: "100%",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: "64px",
                background:
                    "linear-gradient(140deg, #f9fbf5 0%, #f4fffb 58%, #eaf6f7 100%)",
                color: "#17242f",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                position: "relative",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    top: "-80px",
                    right: "-90px",
                    width: "380px",
                    height: "380px",
                    borderRadius: "9999px",
                    background: "rgba(15, 118, 110, 0.14)",
                }}
            />
            <div
                style={{
                    position: "absolute",
                    bottom: "-140px",
                    left: "-90px",
                    width: "430px",
                    height: "430px",
                    borderRadius: "9999px",
                    background: "rgba(245, 158, 11, 0.12)",
                }}
            />

            <p
                style={{
                    margin: 0,
                    fontSize: 28,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: "#115e59",
                    fontWeight: 700,
                }}
            >
                Software Engineer Portfolio
            </p>

            <h1
                style={{
                    margin: "18px 0 0",
                    fontSize: 82,
                    lineHeight: 1,
                    fontWeight: 800,
                }}
            >
                Garvish Panchal
            </h1>

            <p
                style={{
                    margin: "22px 0 0",
                    maxWidth: "88%",
                    fontSize: 34,
                    lineHeight: 1.3,
                    color: "#2f3f4a",
                }}
            >
                Scalable web systems, performance optimization, and clean
                architecture.
            </p>
        </div>,
        size
    );
}
