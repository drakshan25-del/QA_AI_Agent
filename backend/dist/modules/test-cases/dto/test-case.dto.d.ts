export declare class GenerateTestCasesDto {
    requirementIds?: string[];
    minCases?: number;
}
export declare class UpdateTestCaseDto {
    title?: string;
    objective?: string;
    category?: string;
    priority?: string;
    preconditions?: string[];
    steps?: string[];
    expectedResults?: string[];
    testData?: Record<string, string>;
    automationSuitability?: string;
}
