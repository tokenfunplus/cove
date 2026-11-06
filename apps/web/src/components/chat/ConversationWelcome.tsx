import { welcomeStyles } from "@/styles/welcome";
import { SkinIllustration } from "@/components/chat/SkinIllustration";
import { useSkin } from "@/theme/skin";
import { Button } from "@/components/ui/button";
import { CoveMark } from "@/components/ui/CoveMark";
import { Heart, Lightbulb, PenLine, Sparkles } from "lucide-react";
import { type ApplicationCopy } from "@/messages";

export function ConversationWelcome({
  copy,
  onSelectPrompt,
}: {
  copy: ApplicationCopy;
  onSelectPrompt?: (value: string) => void;
}) {
  const skin = useSkin();
  return (
    <div className={welcomeStyles.conversationWelcome}>
      <div
        className={
          skin === "grove"
            ? undefined
            : "grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(128px,28%)]"
        }
      >
        <div>
          {skin === "grove" && (
            <div
              className={welcomeStyles.conversationWelcome_illustration}
              aria-hidden="true"
            >
              <CoveMark />
              <span className={welcomeStyles.conversationWelcome_spark}>
                <Sparkles size={17} />
              </span>
            </div>
          )}
          {skin === "grove" && (
            <p className={welcomeStyles.conversationWelcome_eyebrow}>
              {copy.coverEyebrow}
            </p>
          )}
          <h2 className={welcomeStyles.conversationWelcome_title}>
            {copy.coverTitleA}
            <br />
            {copy.coverTitleB}{" "}
            <span className="whitespace-nowrap text-primary">
              {copy.coverTitleC}.
            </span>
          </h2>
          <p className={welcomeStyles.conversationWelcome_sub}>
            {copy.coverSubtitle}
          </p>
        </div>
        {skin !== "grove" && (
          <div className="hidden sm:block">
            <SkinIllustration skin={skin} />
          </div>
        )}
      </div>
      {onSelectPrompt ? (
        <SuggestedPrompts copy={copy} onSelect={onSelectPrompt} />
      ) : null}
    </div>
  );
}

function SuggestedPrompts({
  copy,
  onSelect,
}: {
  copy: ApplicationCopy;
  onSelect: (value: string) => void;
}) {
  return (
    <section
      className={welcomeStyles.conversationSuggestions}
      aria-label={copy.suggested}
    >
      <p className={welcomeStyles.conversationSuggestions_heading}>
        <span className="conversation-suggestions__label">
          {copy.suggested}
        </span>
      </p>
      <div className={welcomeStyles.conversationSuggestions_list}>
        <Button
          variant="outline"
          className={welcomeStyles.suggest}
          type="button"
          onClick={() => onSelect(copy.suggest01Title)}
        >
          <span className={welcomeStyles.suggest_no}>
            <PenLine size={15} aria-hidden="true" />
          </span>
          <span className={welcomeStyles.suggest_t}>{copy.suggest01Title}</span>
          <span className={welcomeStyles.suggest_d}>
            {copy.suggest01Detail}
          </span>
        </Button>
        <Button
          variant="outline"
          className={welcomeStyles.suggest}
          type="button"
          onClick={() => onSelect(copy.suggest02Title)}
        >
          <span className={welcomeStyles.suggest_no}>
            <Lightbulb size={15} aria-hidden="true" />
          </span>
          <span className={welcomeStyles.suggest_t}>{copy.suggest02Title}</span>
          <span className={welcomeStyles.suggest_d}>
            {copy.suggest02Detail}
          </span>
        </Button>
        <Button
          variant="outline"
          className={welcomeStyles.suggest}
          type="button"
          onClick={() => onSelect(copy.suggest03Title)}
        >
          <span className={welcomeStyles.suggest_no}>
            <Heart size={15} aria-hidden="true" />
          </span>
          <span className={welcomeStyles.suggest_t}>{copy.suggest03Title}</span>
          <span className={welcomeStyles.suggest_d}>
            {copy.suggest03Detail}
          </span>
        </Button>
      </div>
    </section>
  );
}
