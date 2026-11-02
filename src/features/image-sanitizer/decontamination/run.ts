import { REDUCED_TIMELINE, TIMELINE, sampleTimeline, type Resolution, type RunOutcome, type TimelineConfig, type TimelineSample } from "./timeline";

let nextRunId = 1;

/**
 * One cleaning run's single clock. Created when processing starts; resolved
 * once with the real outcome. A new run gets a new object, so a late result
 * from an old run can never complete a newer one.
 */
export class DecontaminationRun {
  readonly id = nextRunId++;
  readonly config: TimelineConfig;
  readonly reduced: boolean;
  readonly #clock: () => number;
  readonly #start: number;
  #resolution: Resolution | null = null;

  constructor(reduced: boolean, clock: () => number = () => performance.now()) {
    this.reduced = reduced;
    this.config = reduced ? REDUCED_TIMELINE : TIMELINE;
    this.#clock = clock;
    this.#start = clock();
  }

  /** Seconds since the run started. */
  elapsed(): number {
    return (this.#clock() - this.#start) / 1000;
  }

  /** Records the real result. Only the first call counts. */
  resolve(outcome: RunOutcome): boolean {
    if (this.#resolution) return false;
    this.#resolution = { at: this.elapsed(), outcome };
    return true;
  }

  get outcome(): RunOutcome | null {
    return this.#resolution?.outcome ?? null;
  }

  sample(): TimelineSample {
    return sampleTimeline(this.elapsed(), this.#resolution, this.config);
  }
}
