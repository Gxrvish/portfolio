// Runs render-blocking in <head> before paint.
// 1) Apply persisted/system color theme (no flash).
// 2) Manual scroll restoration on reload.
(() => {
    try {
        const storedTheme = window.localStorage.getItem("theme");
        const theme =
            storedTheme === "dark" || storedTheme === "light"
                ? storedTheme
                : window.matchMedia("(prefers-color-scheme: dark)").matches
                  ? "dark"
                  : "light";

        document.documentElement.setAttribute("data-theme", theme);
    } catch {
        document.documentElement.setAttribute("data-theme", "light");
    }

    try {
        if ("scrollRestoration" in history) {
            history.scrollRestoration = "manual";
        }

        const key =
            "scroll:" + window.location.pathname + window.location.search;
        const navEntry = performance.getEntriesByType("navigation")[0];
        const isReload = navEntry && navEntry.type === "reload";

        const saveScrollPosition = () => {
            window.sessionStorage.setItem(key, String(window.scrollY || 0));
        };

        window.addEventListener("beforeunload", saveScrollPosition);
        window.addEventListener("pagehide", saveScrollPosition);

        if (isReload) {
            const saved = window.sessionStorage.getItem(key);
            const savedY = saved ? Number(saved) : 0;

            if (Number.isFinite(savedY)) {
                const restore = () => window.scrollTo(0, savedY);
                restore();
                requestAnimationFrame(restore);
                window.addEventListener("load", restore, { once: true });
            } else {
                window.scrollTo(0, 0);
            }
        } else {
            window.sessionStorage.removeItem(key);
            window.scrollTo(0, 0);
        }
    } catch {
        window.scrollTo(0, 0);
    }
})();
