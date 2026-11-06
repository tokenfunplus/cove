import { type ApplicationCopy } from "@/messages";
import { comparisonStyles } from "@/styles/comparison";

export function ComparisonSummary({
  targetCount,
  verifiedCount,
  selected,
  skipped,
  copy,
}: {
  targetCount: number;
  verifiedCount: number;
  selected: boolean;
  skipped: boolean;
  copy: ApplicationCopy;
}) {
  return (
    <div className={comparisonStyles.modelComparisonGrid_spec}>
      <span>
        {copy.specTargets} <b>{targetCount}</b>
      </span>
      <span>
        {copy.verificationVerified}{" "}
        <b>
          {verifiedCount}/{targetCount}
        </b>
      </span>
      {selected && <span>{copy.selectedContextHint}</span>}
      {skipped && <span>{copy.skippedContextHint}</span>}
    </div>
  );
}
