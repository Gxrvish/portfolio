"use client";

import { useEffect, useState } from "react";

import { siteConfig } from "@/config/site";

type ContributionDay = {
    date: string;
    count: number;
    level: 0 | 1 | 2 | 3 | 4;
};

type ApiResponse = {
    total: Record<string, number>;
    contributions: ContributionDay[];
};

const USERNAME = siteConfig.socials.github.split("/").pop() ?? "";
const API_URL = `https://github-contributions-api.jogruber.de/v4/${USERNAME}?y=last`;

const formatTitle = (day: ContributionDay) =>
    `${day.count} contribution${day.count === 1 ? "" : "s"} on ${day.date}`;

export function GithubHeatmap() {
    const [days, setDays] = useState<ContributionDay[] | null>(null);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        let cancelled = false;

        fetch(API_URL)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<ApiResponse>;
            })
            .then((data) => {
                if (cancelled) return;
                setDays(data.contributions);
                setTotal(data.total.lastYear ?? 0);
            })
            .catch(() => {
                // Decorative section; stay hidden if the API is down.
            });

        return () => {
            cancelled = true;
        };
    }, []);

    if (!days) return null;

    // Pad the front so the first column starts on Sunday, matching GitHub.
    const offset = new Date(days[0].date).getDay();
    const cells: (ContributionDay | null)[] = [
        ...Array.from({ length: offset }, () => null),
        ...days,
    ];

    const weeks: (ContributionDay | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
        weeks.push(cells.slice(i, i + 7));
    }

    return (
        <section className="section" aria-labelledby="github-activity">
            <h2 id="github-activity" className="section-title">
                GitHub Activity
            </h2>
            <div
                className="heatmap"
                role="img"
                aria-label={`${total} contributions in the last year`}
            >
                {weeks.map((week, wi) => (
                    <div className="heatmap-week" key={wi}>
                        {week.map((day, di) =>
                            day ? (
                                <span
                                    key={day.date}
                                    className="heatmap-day"
                                    data-level={day.level}
                                    title={formatTitle(day)}
                                />
                            ) : (
                                <span
                                    key={`pad-${wi}-${di}`}
                                    className="heatmap-day is-empty"
                                />
                            )
                        )}
                    </div>
                ))}
            </div>
            <p className="heatmap-meta">
                {total} contributions in the last year ·{" "}
                <a
                    href={siteConfig.socials.github}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    @{USERNAME}
                </a>
            </p>
        </section>
    );
}
