import { primitivesStyles } from "@/styles/primitives";
import { verificationStyles } from "@/styles/verification";
import { Button } from "@/components/ui/button";
import { SignatureVerificationDialog } from "@/components/verification/SignatureVerificationDialog";
import { VerificationDialog } from "@/components/verification/VerificationDialog";
import { signatureVerificationAvailable } from "@/lib/inference/verification-record";
import { type ApplicationCopy } from "@/messages";
import {
  type GenerationVerification,
  type VerificationEvidence,
} from "@cove/api-contract";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { BadgeCheck, ChevronDown } from "lucide-react";
import { useState } from "react";

export type VerificationRefresh = (
  kind: "model" | "gateway",
) => Promise<VerificationEvidence | undefined> | void;

export async function invokeVerificationRefresh(
  refresh: VerificationRefresh | undefined,
  kind: "model" | "gateway",
): Promise<VerificationEvidence | undefined> {
  return (await refresh?.(kind)) as VerificationEvidence | undefined;
}

export function VerificationDetailsButton({
  verification,
  providerName,
  modelId,
  copy,
  onVerifyAgain,
}: {
  verification?: GenerationVerification;
  providerName?: string;
  modelId?: string;
  copy: ApplicationCopy;
  onVerifyAgain?: VerificationRefresh;
}) {
  const [open, setOpen] = useState(false);
  const [openKind, setOpenKind] = useState<"model" | "gateway">();
  const [signatureOpen, setSignatureOpen] = useState(false);
  const evidence = verification?.evidence;
  if (!evidence) return null;
  const primaryKind = evidence.kind === "gateway" ? "gateway" : "model";
  const primaryLabel =
    primaryKind === "gateway"
      ? copy.gatewayVerification
      : copy.modelVerification;
  return (
    <>
      <Menu as="div" className={primitivesStyles.message_verificationMenu}>
        <MenuButton
          as={Button}
          variant="ghost"
          aria-label={primaryLabel}
          className={verificationStyles.message_verificationTrigger}
          title={primaryLabel}
          type="button"
        >
          <BadgeCheck aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>{primaryLabel}</span>
          <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
        </MenuButton>
        <MenuItems
          anchor="bottom start"
          portal
          className={primitivesStyles.message_verificationMenuItems}
          transition
        >
          <MenuItem>
            <Button
              variant="ghost"
              onClick={() => {
                setOpenKind(primaryKind);
                setOpen(true);
              }}
              type="button"
            >
              {primaryKind === "gateway"
                ? copy.gatewayVerification
                : copy.modelVerification}
            </Button>
          </MenuItem>
          {evidence.kind === "model" && evidence.gateway ? (
            <MenuItem>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpenKind("gateway");
                  setOpen(true);
                }}
                type="button"
              >
                {copy.gatewayVerification}
              </Button>
            </MenuItem>
          ) : null}
          {evidence.kind === "gateway" && evidence.model ? (
            <MenuItem>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpenKind("model");
                  setOpen(true);
                }}
                type="button"
              >
                {copy.modelVerification}
              </Button>
            </MenuItem>
          ) : null}
          {onVerifyAgain ? (
            <MenuItem>
              <Button
                variant="ghost"
                onClick={() => void onVerifyAgain(primaryKind)}
                type="button"
              >
                {copy.verifyAgain}
              </Button>
            </MenuItem>
          ) : null}
          {signatureVerificationAvailable(verification) ? (
            <MenuItem>
              <Button
                variant="ghost"
                onClick={() => setSignatureOpen(true)}
                type="button"
              >
                {copy.signatureVerification}
              </Button>
            </MenuItem>
          ) : null}
        </MenuItems>
      </Menu>
      {open ? (
        <VerificationDialog
          kind={openKind ?? evidence.kind}
          evidence={
            openKind === "gateway"
              ? (evidence.gateway ?? evidence)
              : openKind === "model"
                ? (evidence.model ?? evidence)
                : evidence
          }
          providerName={providerName}
          modelId={modelId}
          copy={copy}
          onVerifyAgain={(kind) =>
            invokeVerificationRefresh(onVerifyAgain, kind)
          }
          onClose={() => {
            setOpen(false);
            setOpenKind(undefined);
          }}
        />
      ) : null}
      {signatureOpen && verification ? (
        <SignatureVerificationDialog
          verification={verification}
          copy={copy}
          onClose={() => setSignatureOpen(false)}
        />
      ) : null}
    </>
  );
}
