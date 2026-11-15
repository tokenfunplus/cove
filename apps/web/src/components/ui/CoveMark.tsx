import { primitivesStyles } from "@/styles/primitives";
/** The shared Cove wave mark, served locally at every display size. */
export function CoveMark() {
  return (
    <img
      aria-hidden="true"
      alt=""
      className={primitivesStyles.coveMark}
      src="/assets/cove-mark.svg"
      width="256"
      height="256"
      draggable={false}
    />
  );
}
