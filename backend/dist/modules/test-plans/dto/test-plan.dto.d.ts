export declare class GenerateTestPlanDto {
    requirementIds?: string[];
    title?: string;
}
export declare class UpdateTestPlanDto {
    title?: string;
    sections?: Record<string, unknown>;
    changeSummary?: string;
}
