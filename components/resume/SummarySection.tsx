import { Section } from "@/components/resume/Section";

type SummarySectionProps = {
    summary: string;
};

export function SummarySection({ summary }: SummarySectionProps) {
    return (
        <Section id="summary" title="Summary">
            <p className="summary-text">{summary}</p>
        </Section>
    );
}
