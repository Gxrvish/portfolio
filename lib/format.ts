export function formatDate(iso: string): string {
    if (!iso) {
        return "";
    }

    const date = new Date(`${iso}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
        return iso;
    }

    return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    }).format(date);
}
