import { ImageResponse } from "next/og";

import { resumeData } from "@/data/resume";

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
                padding: "56px",
                background: "#060a0f",
                color: "#c7d4df",
                fontFamily: "monospace",
                position: "relative",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    top: "-120px",
                    right: "-100px",
                    width: "440px",
                    height: "440px",
                    borderRadius: "9999px",
                    background: "rgba(82, 240, 165, 0.16)",
                }}
            />
            <div
                style={{
                    position: "absolute",
                    bottom: "-160px",
                    left: "-110px",
                    width: "480px",
                    height: "480px",
                    borderRadius: "9999px",
                    background: "rgba(56, 217, 240, 0.12)",
                }}
            />

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    color: "#7c8c9b",
                    fontSize: 24,
                }}
            >
                <div
                    style={{
                        width: 16,
                        height: 16,
                        borderRadius: 9999,
                        background: "#f87171",
                    }}
                />
                <div
                    style={{
                        width: 16,
                        height: 16,
                        borderRadius: 9999,
                        background: "#f9c552",
                    }}
                />
                <div
                    style={{
                        width: 16,
                        height: 16,
                        borderRadius: 9999,
                        background: "#52f0a5",
                    }}
                />
                <span style={{ marginLeft: 16 }}>
                    visitor@garvish: ~/portfolio
                </span>
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    flex: 1,
                }}
            >
                <p
                    style={{
                        margin: 0,
                        fontSize: 30,
                        color: "#7c8c9b",
                    }}
                >
                    <span style={{ color: "#52f0a5" }}>visitor@garvish</span>:
                    <span style={{ color: "#7c8c9b" }}>~</span>${" "}
                    <span style={{ color: "#c7d4df" }}>whoami</span>
                </p>

                <h1
                    style={{
                        margin: "14px 0 0",
                        fontSize: 88,
                        lineHeight: 1,
                        fontWeight: 800,
                        color: "#52f0a5",
                    }}
                >
                    {resumeData.profile.name}
                </h1>

                <p
                    style={{
                        margin: "20px 0 0",
                        fontSize: 34,
                        color: "#38d9f0",
                        letterSpacing: 2,
                        textTransform: "uppercase",
                    }}
                >
                    {resumeData.profile.role}
                </p>

                <p
                    style={{
                        margin: "26px 0 0",
                        maxWidth: "90%",
                        fontSize: 28,
                        lineHeight: 1.4,
                        color: "#9aa7b4",
                    }}
                >
                    {resumeData.profile.tagline}
                </p>
            </div>

            <p
                style={{
                    margin: 0,
                    fontSize: 24,
                    color: "#7c8c9b",
                }}
            >
                <span style={{ color: "#52f0a5" }}>❯</span>{" "}
                {resumeData.websiteUrl.replace("https://", "")}
            </p>
        </div>,
        size
    );
}
