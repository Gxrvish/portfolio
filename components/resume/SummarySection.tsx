import { Section } from "@/components/resume/Section";

type SummarySectionProps = {
    summary: string;
};

export function SummarySection({ summary }: SummarySectionProps) {
    return (
        <Section id="summary" title="About">
            <p className="prose-text">{summary}</p>
        </Section>
    );
}
