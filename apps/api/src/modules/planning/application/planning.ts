import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Geocoder } from '../../../shared/application/geocoder.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { CreatePlan } from './create-plan.js';
import { PlanQueries } from './plan-queries.js';
import type {
  FlowDefaults,
  PlanActivity,
  PlanDrafter,
  PlanningUnitOfWork,
  ProfileReader,
  RunStats,
  WalletReader,
} from './ports.js';
import { UpdatePlan } from './update-plan.js';

export interface PlanningApplicationDeps {
  uow: PlanningUnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  drafter: PlanDrafter;
  geocoder: Geocoder;
  profiles: ProfileReader;
  flows: FlowDefaults;
  runStats: RunStats;
  wallet: WalletReader;
  activity: PlanActivity;
  /** Plans per Business per UTC day (default 30). */
  dailyPlanLimit?: number;
}

export interface PlanningApplication {
  createPlan: CreatePlan;
  updatePlan: UpdatePlan;
  queries: PlanQueries;
}

export function createPlanningApplication(deps: PlanningApplicationDeps): PlanningApplication {
  return {
    createPlan: new CreatePlan(deps),
    updatePlan: new UpdatePlan(deps),
    queries: new PlanQueries(deps),
  };
}
