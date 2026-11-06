import { messagesStyles } from "@/styles/messages";
import { type ApplicationCopy } from "@/messages";
import { type ProviderSnapshot } from "@cove/api-contract";
import { ChevronDown, LockKeyhole, ShieldCheck } from "lucide-react";

export function ProviderSnapshotView({
  snapshot,
  copy,
}: {
  snapshot: ProviderSnapshot;
  copy: ApplicationCopy;
}) {
  return (
    <details className={messagesStyles.message_snapshot}>
      <summary
        aria-label={`${copy.providerSnapshot}: ${snapshot.provider_name}, ${snapshot.model_id}`}
      >
        <span className={messagesStyles.message_snapshotSummary}>
          <span className="snapshot__icon" aria-hidden="true">
            <ShieldCheck size={16} strokeWidth={1.8} />
          </span>
          <span>
            <strong>{copy.providerSnapshot}</strong>
            <small title={`${snapshot.provider_name} · ${snapshot.model_id}`}>
              {snapshot.provider_name} · {snapshot.model_id}
            </small>
          </span>
        </span>
        <span className={messagesStyles.message_snapshotSecurity}>
          <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.8} />
          {snapshot.transport_security.toUpperCase()}
          <ChevronDown
            aria-hidden="true"
            className="message__snapshot-chevron"
            size={15}
            strokeWidth={1.8}
          />
        </span>
      </summary>
      <div className={messagesStyles.message_snapshotDetails}>
        <dl>
          <div>
            <dt>{copy.provider}</dt>
            <dd>{snapshot.provider_id}</dd>
          </div>
          <div>
            <dt>{copy.model}</dt>
            <dd>{snapshot.model_id}</dd>
          </div>
          <div>
            <dt>{copy.runtime}</dt>
            <dd>{snapshot.runtime_location}</dd>
          </div>
          <div>
            <dt>{copy.destination}</dt>
            <dd>{snapshot.destination}</dd>
          </div>
          <div>
            <dt>{copy.transport}</dt>
            <dd>{snapshot.transport_security.toUpperCase()}</dd>
          </div>
        </dl>
        <div className={messagesStyles.message_snapshotNotice}>
          <span>{copy.privacyNotice}</span>
          <small>{snapshot.privacy_notice}</small>
        </div>
      </div>
    </details>
  );
}
