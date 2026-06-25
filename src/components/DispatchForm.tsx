import { startDispatch } from "@/app/dispatch/[ideaId]/actions";
import {
  AUTONOMY_LEVELS,
  SPRINT_DEPTHS,
  autonomyConfig,
  sprintDepthConfig,
  type AutonomyLevel,
  type SprintDepth
} from "@/lib/domain";

type DispatchFormProps = {
  ideaId?: string;
  generatedIdeaId?: string;
  suggestedDepth: SprintDepth;
  suggestedAutonomy: AutonomyLevel;
};

export function DispatchForm({
  ideaId,
  generatedIdeaId,
  suggestedDepth,
  suggestedAutonomy
}: DispatchFormProps) {
  return (
    <form action={startDispatch} className="grid gap-6 rounded-md border border-rf-border bg-rf-panel p-6">
      {ideaId ? <input type="hidden" name="ideaId" value={ideaId} /> : null}
      {generatedIdeaId ? (
        <input type="hidden" name="generatedIdeaId" value={generatedIdeaId} />
      ) : null}

      <section>
        <h2 className="text-lg font-semibold text-rf-white">Sprint depth</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {SPRINT_DEPTHS.map((key) => {
            const config = sprintDepthConfig[key];
            return (
              <label key={key} className="rounded-md border border-rf-border bg-rf-surface p-3 text-rf-white">
                <input
                  className="mr-2"
                  type="radio"
                  name="sprintDepth"
                  value={key}
                  defaultChecked={key === suggestedDepth}
                />
                <span className="font-semibold capitalize">{key}</span>
                <p className="mt-1 text-sm text-rf-muted">{config.expectedDuration}</p>
                <p className="mt-1 text-sm text-rf-muted">{config.description}</p>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-rf-white">Autonomy</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {AUTONOMY_LEVELS.map((key) => {
            const config = autonomyConfig[key];
            return (
              <label key={key} className="rounded-md border border-rf-border bg-rf-surface p-3 text-rf-white">
                <input
                  className="mr-2"
                  type="radio"
                  name="autonomyLevel"
                  value={key}
                  defaultChecked={key === suggestedAutonomy}
                />
                <span className="font-semibold capitalize">{key}</span>
                <p className="mt-1 text-sm text-rf-muted">{config.description}</p>
              </label>
            );
          })}
        </div>
      </section>

      <div className="rounded-md border border-rf-warning/40 bg-rf-warning/10 p-3 text-sm text-rf-warning">
        Medium and high autonomy may create artifacts or run experiments. High autonomy should only be
        used after budget limits are configured.
      </div>

      <button className="w-fit rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-violetSoft">
        Start viability sprint
      </button>
    </form>
  );
}
