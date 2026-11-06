import {
  inferenceModeForMetadata,
  modelMetadataForTarget,
  secureInferenceTargetSelected,
  secureTargetForCatalog,
  type ActiveSelection,
  type ModelCatalogs,
} from "@/components/providers/model-selection";
import {
  activePrivateConnectionPhase,
  type PrivateConnectionProgressPhase,
} from "@/components/verification/PrivateConnectionProgress";
import { type GenerationState } from "@/hooks/chat/use-generation-state";
import { type WorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { type WorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import { privateInferenceFailureMessage } from "@/lib/error-messages";
import {
  runPrivateConnectionProbe,
  type PrivateConnectionProbeResult,
} from "@/lib/inference/private-connection";
import { type SecureInferenceVerification } from "@/lib/inference/secure-inference";
import {
  contractEvidenceFor,
  verificationEvidenceForDialog,
} from "@/lib/inference/verification-record";
import { type ApplicationCopy } from "@/messages";
import {
  type ProviderProfile,
  type VerificationEvidence,
} from "@cove/api-contract";

type Dependencies = Pick<
  WorkspaceState,
  "activeModelSet" | "providerProfiles" | "conversationView"
> &
  Pick<
    GenerationState,
    | "isSending"
    | "secureInferenceAbortRef"
    | "setIsSending"
    | "secureInferenceFinishedRef"
    | "generationBatch"
  > &
  Pick<
    WorkspaceUi,
    "setPrivateConnectionProgress" | "setFeedback" | "setWorkspaceVerification"
  > & {
    catalogs: ModelCatalogs;
    copy: ApplicationCopy;
    activeSelection: ActiveSelection;
  };

export function usePrivateVerification({
  activeModelSet,
  providerProfiles,
  isSending,
  catalogs,
  secureInferenceAbortRef,
  setPrivateConnectionProgress,
  setFeedback,
  setIsSending,
  secureInferenceFinishedRef,
  copy,
  generationBatch,
  conversationView,
  activeSelection,
  setWorkspaceVerification,
}: Dependencies) {
  async function handleVerifyPrivateConnection() {
    const targets = activeModelSet
      .map((target) => ({
        target,
        profile: providerProfiles.find(
          (candidate) => candidate.id === target.providerId,
        ),
      }))
      .filter(
        (
          entry,
        ): entry is { target: ActiveSelection; profile: ProviderProfile } =>
          Boolean(entry.profile),
      );
    if (
      isSending ||
      targets.length === 0 ||
      !secureInferenceTargetSelected(activeModelSet, providerProfiles, catalogs)
    )
      return;
    const controller = new AbortController();
    secureInferenceAbortRef.current = controller;
    setPrivateConnectionProgress({
      phase: "environment",
      providerName: targets
        .map(({ profile }) => profile.name)
        .filter((name, index, names) => names.indexOf(name) === index)
        .join(" + "),
      modelIds: targets.map(({ target }) => target.modelId),
    });
    setFeedback(undefined);
    setIsSending(true);
    let verifiedProbe: SecureInferenceVerification | undefined;
    let probeFailureReason: string | undefined;
    const verification = import("@/lib/inference/secure-inference").then(
      ({ createSecureInferenceTransport }) =>
        Promise.all(
          targets.map(({ target, profile }) =>
            runPrivateConnectionProbe({
              transport: createSecureInferenceTransport(),
              target,
              profile,
              signal: controller.signal,
              onStatus(status) {
                const phase: PrivateConnectionProgressPhase =
                  status === "verifying_environment"
                    ? "environment"
                    : status === "streaming"
                      ? "encrypted_path"
                      : "response";
                setPrivateConnectionProgress((current) =>
                  current ? { ...current, phase } : current,
                );
              },
              onVerification(result) {
                if (!verifiedProbe) verifiedProbe = result;
              },
              onFailure(reason) {
                probeFailureReason = reason;
              },
            }),
          ),
        ).then((results) =>
          results.every((result) => result === "verified")
            ? "verified"
            : results.some((result) => result === "stopped")
              ? "stopped"
              : ("failed" as PrivateConnectionProbeResult),
        ),
    );
    secureInferenceFinishedRef.current = verification;
    try {
      const result = await verification;
      if (!controller.signal.aborted) {
        const dialogState =
          result === "verified" && verifiedProbe
            ? verificationEvidenceForDialog(verifiedProbe)
            : undefined;
        if (dialogState) {
          setPrivateConnectionProgress((current) =>
            current
              ? { ...current, phase: "complete", verification: dialogState }
              : current,
          );
          setFeedback(copy.privateConnectionVerified, "success");
        } else {
          const message = privateInferenceFailureMessage(
            probeFailureReason,
            copy,
          );
          setPrivateConnectionProgress((current) =>
            current
              ? {
                  ...current,
                  failedAt: activePrivateConnectionPhase(current.phase),
                  phase: "failed",
                  message,
                }
              : current,
          );
          setFeedback(message);
        }
      }
    } catch {
      const message = privateInferenceFailureMessage(probeFailureReason, copy);
      setPrivateConnectionProgress((current) =>
        current
          ? {
              ...current,
              failedAt: activePrivateConnectionPhase(current.phase),
              phase: "failed",
              message,
            }
          : current,
      );
      setFeedback(message);
    } finally {
      if (controller.signal.aborted) {
        setPrivateConnectionProgress(undefined);
        setFeedback(copy.generationStopped, "info");
      }
      if (secureInferenceAbortRef.current === controller) {
        secureInferenceAbortRef.current = undefined;
        setIsSending(false);
      }
      if (secureInferenceFinishedRef.current === verification)
        secureInferenceFinishedRef.current = undefined;
    }
  }

  async function verifyEnvironmentForTarget(
    target: ActiveSelection,
    profile: ProviderProfile,
    kind: "model" | "gateway",
  ): Promise<VerificationEvidence> {
    const { createSecureInferenceTransport } =
      await import("@/lib/inference/secure-inference");
    const transport = createSecureInferenceTransport();
    if (!transport.verifyEnvironment)
      throw new Error("environment verification is unavailable");
    const mode = inferenceModeForMetadata(
      modelMetadataForTarget(catalogs, target),
    );
    if (!mode) throw new Error("environment verification is unavailable");
    const environment = await transport.verifyEnvironment({
      target: {
        id: profile.id,
        kind: profile.kind,
        model_id: target.modelId,
        configured: profile.configured,
      },
      mode,
    });
    setFeedback(copy.privateConnectionVerified, "success");
    if (kind === "model") {
      if (!environment.model)
        throw new Error("model attestation is unavailable for this model");
      return contractEvidenceFor(environment.model, environment);
    }
    return contractEvidenceFor(environment.gateway, environment);
  }

  async function handleVerifyAgain(
    targetID: string,
    kind: "model" | "gateway",
  ): Promise<VerificationEvidence | undefined> {
    const target = [
      ...(generationBatch?.targets ?? []),
      ...(conversationView?.generation_batches?.flatMap(
        (batch) => batch.targets,
      ) ?? []),
    ].find((candidate) => candidate.id === targetID);
    const profile = target
      ? providerProfiles.find(
          (candidate) => candidate.id === target.provider_id,
        )
      : undefined;
    if (
      !target ||
      !profile ||
      !secureTargetForCatalog(
        { providerId: target.provider_id, modelId: target.model_id },
        providerProfiles,
        catalogs,
      ) ||
      isSending
    )
      return;
    setFeedback(copy.privateInferenceVerifying, "info");
    try {
      return await verifyEnvironmentForTarget(
        { providerId: target.provider_id, modelId: target.model_id },
        profile,
        kind,
      );
    } catch (error) {
      setFeedback(privateInferenceFailureMessage(error, copy));
      return undefined;
    }
  }

  async function handleVerifySelectedModel(): Promise<void> {
    const profile = providerProfiles.find(
      (candidate) => candidate.id === activeSelection.providerId,
    );
    if (
      isSending ||
      !profile ||
      !secureTargetForCatalog(activeSelection, providerProfiles, catalogs) ||
      !activeSelection.modelId
    )
      return;
    setFeedback(copy.privateInferenceVerifying, "info");
    try {
      const evidence = await verifyEnvironmentForTarget(
        activeSelection,
        profile,
        "model",
      );
      setWorkspaceVerification({ kind: "model", evidence });
    } catch (error) {
      setFeedback(privateInferenceFailureMessage(error, copy));
    }
  }

  async function handleVerifyWorkspaceAgain(
    kind: "model" | "gateway",
  ): Promise<VerificationEvidence | undefined> {
    const profile = providerProfiles.find(
      (candidate) => candidate.id === activeSelection.providerId,
    );
    if (
      !profile ||
      !secureTargetForCatalog(activeSelection, providerProfiles, catalogs) ||
      !activeSelection.modelId
    )
      return undefined;
    try {
      const evidence = await verifyEnvironmentForTarget(
        activeSelection,
        profile,
        kind,
      );
      setWorkspaceVerification({ kind, evidence });
      return evidence;
    } catch (error) {
      setFeedback(privateInferenceFailureMessage(error, copy));
      return undefined;
    }
  }

  return {
    handleVerifyPrivateConnection,
    verifyEnvironmentForTarget,
    handleVerifyAgain,
    handleVerifySelectedModel,
    handleVerifyWorkspaceAgain,
  };
}
