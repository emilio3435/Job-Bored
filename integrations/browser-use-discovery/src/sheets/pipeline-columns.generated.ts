// GENERATED from schemas/pipeline-row.v1.json. Do not edit by hand.
// scripts/test-pipeline-contract.mjs and tests/sheets/pipeline-columns-contract.test.ts
// fail when this file and the schema disagree.

export type PipelineDiscoveryMerge = "overwrite" | "lockable" | "fillIfEmpty" | "preserve";

export type PipelineColumn = {
  readonly id: string;
  readonly letter: string;
  readonly headerLabel: string;
  readonly sheetIndex: number;
  readonly discoveryMerge: PipelineDiscoveryMerge;
};

export const PIPELINE_COLUMNS: readonly PipelineColumn[] = [
  { id: "dateFound", letter: "A", headerLabel: "Date Found", sheetIndex: 0, discoveryMerge: "fillIfEmpty" },
  { id: "title", letter: "B", headerLabel: "Title", sheetIndex: 1, discoveryMerge: "lockable" },
  { id: "company", letter: "C", headerLabel: "Company", sheetIndex: 2, discoveryMerge: "lockable" },
  { id: "location", letter: "D", headerLabel: "Location", sheetIndex: 3, discoveryMerge: "lockable" },
  { id: "link", letter: "E", headerLabel: "Link", sheetIndex: 4, discoveryMerge: "overwrite" },
  { id: "source", letter: "F", headerLabel: "Source", sheetIndex: 5, discoveryMerge: "fillIfEmpty" },
  { id: "salary", letter: "G", headerLabel: "Salary", sheetIndex: 6, discoveryMerge: "lockable" },
  { id: "fitScore", letter: "H", headerLabel: "Fit Score", sheetIndex: 7, discoveryMerge: "overwrite" },
  { id: "priority", letter: "I", headerLabel: "Priority", sheetIndex: 8, discoveryMerge: "fillIfEmpty" },
  { id: "tags", letter: "J", headerLabel: "Tags", sheetIndex: 9, discoveryMerge: "fillIfEmpty" },
  { id: "fitAssessment", letter: "K", headerLabel: "Fit Assessment", sheetIndex: 10, discoveryMerge: "fillIfEmpty" },
  { id: "contact", letter: "L", headerLabel: "Contact", sheetIndex: 11, discoveryMerge: "fillIfEmpty" },
  { id: "status", letter: "M", headerLabel: "Status", sheetIndex: 12, discoveryMerge: "fillIfEmpty" },
  { id: "appliedDate", letter: "N", headerLabel: "Applied Date", sheetIndex: 13, discoveryMerge: "preserve" },
  { id: "notes", letter: "O", headerLabel: "Notes", sheetIndex: 14, discoveryMerge: "preserve" },
  { id: "followUpDate", letter: "P", headerLabel: "Follow-up Date", sheetIndex: 15, discoveryMerge: "preserve" },
  { id: "talkingPoints", letter: "Q", headerLabel: "Talking Points", sheetIndex: 16, discoveryMerge: "fillIfEmpty" },
  { id: "lastHeardFrom", letter: "R", headerLabel: "Last contact", sheetIndex: 17, discoveryMerge: "preserve" },
  { id: "responseFlag", letter: "S", headerLabel: "Did they reply?", sheetIndex: 18, discoveryMerge: "preserve" },
  { id: "logoUrl", letter: "T", headerLabel: "Logo URL", sheetIndex: 19, discoveryMerge: "overwrite" },
  { id: "matchScore", letter: "U", headerLabel: "Match Score", sheetIndex: 20, discoveryMerge: "overwrite" },
  { id: "favorite", letter: "V", headerLabel: "Favorite", sheetIndex: 21, discoveryMerge: "fillIfEmpty" },
  { id: "dismissedAt", letter: "W", headerLabel: "Dismissed At", sheetIndex: 22, discoveryMerge: "fillIfEmpty" },
  { id: "approvalStatus", letter: "X", headerLabel: "Approval Status", sheetIndex: 23, discoveryMerge: "fillIfEmpty" },
  { id: "editLock", letter: "Y", headerLabel: "Edit Lock", sheetIndex: 24, discoveryMerge: "preserve" },
];
