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
  ideaId: string;
  suggestedDepth: SprintDepth;
  suggestedAutonomy: AutonomyLevel;
};

export function DispatchForm({
  ideaId,
  suggestedDepth,
  suggestedAutonomy
}: DispatchFormProps) {
  return (
    <form action={startDispatch} className="grid gap-6 rounded-lg border border-line bg-white p-6">
      <input type="hidden" name="ideaId" value={ideaId} />

      <section>
        <h2 className="text-lg font-semibold">Sprint depth</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {SPRINT_DEPTHS.map((key) => {
            const config = sprintDepthConfig[key];
            return (
              <label key={key} className="rounded-md border border-line p-3">
                <input
                  className="mr-2"
                  type="radio"
                  name="sprintDepth"
                  value={key}
                  defaultChecked={key === suggestedDepth}
                />
                <span className="font-semibold capitalize">{key}</span>
                <p className="mt-1 text-sm text-slate-600">{config.expectedDuration}</p>
                <p className="mt-1 text-sm text-slate-500">{config.description}</p>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Autonomy</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {AUTONOMY_LEVELS.map((key) => {
            const config = autonomyConfig[key];
            return (
              <label key={key} className="rounded-md border border-line p-3">
                <input
                  className="mr-2"
                  type="radio"
                  name="autonomyLevel"
                  value={key}
                  defaultChecked={key === suggestedAutonomy}
                />
                <span className="font-semibold capitalize">{key}</span>
                <p className="mt-1 text-sm text-slate-500">{config.description}</p>
              </label>
            );
          })}
        </div>
      </section>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Medium and high autonomy may create artifacts or run experiments. High autonomy should only be
        used after budget limits are configured.
      </div>

      <button className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">
        Start viability sprint
      </button>
    </form>
  );
}
