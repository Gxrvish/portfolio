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
                justifyContent: "space-between",
                padding: "72px",
                background: "#0a0a0a",
                color: "#ededed",
                fontFamily: "sans-serif",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    fontSize: 26,
                    color: "#8b8b8b",
                }}
            >
                <div
                    style={{
                        width: 14,
                        height: 14,
                        borderRadius: 9999,
                        background: "#60a5fa",
                    }}
                />
                {resumeData.websiteUrl.replace("https://", "")}
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                    style={{
                        fontSize: 96,
                        fontWeight: 800,
                        letterSpacing: "-0.03em",
                        lineHeight: 1,
                    }}
                >
                    {resumeData.profile.name}
                </div>
                <div
                    style={{
                        marginTop: 22,
                        fontSize: 38,
                        fontWeight: 500,
                        color: "#a3a3a3",
                    }}
                >
                    {resumeData.profile.role}
                </div>
            </div>

            <div
                style={{
                    fontSize: 28,
                    lineHeight: 1.4,
                    color: "#8b8b8b",
                    maxWidth: "85%",
                }}
            >
                {resumeData.profile.tagline}
            </div>
        </div>,
        size
    );
}
