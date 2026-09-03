/**
 * Git Component Index
 * 
 * 從 CodingIDE.tsx 拆出來的 Git UI 組件群
 * 
 * 分層邏輯：Code > Config > Docs > Other > .paaw
 * 程式碼最重要，.paaw 視覺退讓
 */

export { default as GitPanel } from "./GitPanel";
export { default as GitStatusView } from "./GitStatusView";
export { default as GitDiffView } from "./GitDiffView";
export { default as GitReviewView } from "./GitReviewView";
export { default as GitCommitBar } from "./GitCommitBar";
export { default as GitFileGroupCard } from "./GitFileGroup";
export { default as FeatureGroupCard } from "./FeatureGroupCard";
export { default as DecisionCard } from "./DecisionCard";
export {
  classifyGitFile,
  groupGitFiles,
  getStatusEmoji,
  getStatusColorClass,
  getCategoryLabel,
  fileKey,
  pathFromFileKey,
  featuresForPath,
  groupGitFilesByFeature,
} from "./git-helpers";
export type {
  GitFileStatus,
  GitCommit,
  FileCategory,
  GitFileGroup,
  FeatureRef,
  FeatureFileMap,
  FeatureGroup,
} from "./git-helpers";
