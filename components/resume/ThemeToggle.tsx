"use client";

export function ThemeToggle() {
    const handleToggle = () => {
        const currentTheme =
            document.documentElement.getAttribute("data-theme") === "dark"
                ? "dark"
                : "light";
        const nextTheme = currentTheme === "dark" ? "light" : "dark";

        document.documentElement.setAttribute("data-theme", nextTheme);
        window.localStorage.setItem("theme", nextTheme);
    };

    return (
        <button
            type="button"
            className="theme-toggle"
            onClick={handleToggle}
            aria-label="Toggle color theme"
            title="Toggle color theme"
        >
            Toggle theme
        </button>
    );
}
