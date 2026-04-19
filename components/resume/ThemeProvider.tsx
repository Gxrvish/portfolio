"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

const getPreferredTheme = (): Theme => {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
        return storedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
};

export function ThemeProvider({ children }: { children: ReactNode }) {
    useEffect(() => {
        const domTheme = document.documentElement.getAttribute("data-theme");
        if (domTheme === "light" || domTheme === "dark") {
            return;
        }

        const preferredTheme = getPreferredTheme();
        document.documentElement.setAttribute("data-theme", preferredTheme);
    }, []);

    return <>{children}</>;
}
