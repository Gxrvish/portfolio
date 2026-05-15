"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_KEY = "boot:done";

type BootLine = {
    text: string;
    cls?: "ok" | "hl" | "warn";
    suffix?: string;
};

const LINES: BootLine[] = [
    { text: "garvish-os 1.0.0 (tty1)", cls: "hl" },
    { text: "[ OK ] Mounting /dev/portfolio ...", suffix: "ok" },
    { text: "[ OK ] Starting profile.service ...", suffix: "ok" },
    { text: "[ OK ] Loading resume.dataset ...", suffix: "ok" },
    { text: "[ OK ] Indexing skills, experience, projects ...", suffix: "ok" },
    { text: "[ OK ] Optimizing SEO graph (schema.org) ...", suffix: "ok" },
    { text: "login: visitor", cls: "warn" },
    { text: "Authenticated. Welcome to garvish.me", cls: "ok" },
];

const STEP_MS = 230;
const HOLD_MS = 520;
const FADE_MS = 520;

export function BootScreen() {
    const [state, setState] = useState<"boot" | "done">("boot");
    const [shown, setShown] = useState(0);
    const [hidden, setHidden] = useState(false);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    const finish = useCallback(() => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        try {
            window.sessionStorage.setItem(SESSION_KEY, "1");
        } catch {
            /* sessionStorage unavailable */
        }
        setState("done");
        timers.current.push(setTimeout(() => setHidden(true), FADE_MS + 40));
    }, []);

    useEffect(() => {
        let alreadySeen = false;
        try {
            alreadySeen = window.sessionStorage.getItem(SESSION_KEY) === "1";
        } catch {
            /* ignore */
        }

        const reducedMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches;

        if (alreadySeen || reducedMotion) {
            // Skip boot: defer to a microtask so it resolves before paint
            // (no flash) without a synchronous setState in the effect body.
            queueMicrotask(() => setHidden(true));
            return;
        }

        LINES.forEach((_, i) => {
            timers.current.push(
                setTimeout(() => setShown(i + 1), STEP_MS * (i + 1))
            );
        });

        timers.current.push(
            setTimeout(finish, STEP_MS * (LINES.length + 1) + HOLD_MS)
        );

        return () => {
            timers.current.forEach(clearTimeout);
            timers.current = [];
        };
    }, [finish]);

    if (hidden) {
        return null;
    }

    const pct = Math.round((shown / LINES.length) * 100);
    const filled = Math.round((shown / LINES.length) * 24);
    const bar = "█".repeat(filled) + "░".repeat(24 - filled);

    return (
        <div
            className="boot-screen"
            data-state={state}
            role="status"
            aria-live="polite"
            aria-label="Booting portfolio"
        >
            <div className="boot-inner">
                {LINES.slice(0, shown).map((line, i) => (
                    <p key={i} className="boot-line">
                        {line.suffix === "ok" ? (
                            <>
                                <span className="ok">[ OK ]</span>
                                {line.text.replace("[ OK ]", "")}
                            </>
                        ) : (
                            <span className={line.cls ? line.cls : undefined}>
                                {line.text}
                            </span>
                        )}
                    </p>
                ))}
                <p className="boot-bar-wrap">
                    <span className="boot-bar">[{bar}]</span> {pct}%
                    {state === "boot" ? <span className="boot-cursor" /> : null}
                </p>
            </div>
            <button
                type="button"
                className="boot-skip"
                onClick={finish}
                aria-label="Skip boot animation"
            >
                skip ↵
            </button>
        </div>
    );
}
