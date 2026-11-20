import { routePath } from '@app/contracts/common';
import {
  getPublicConfig,
  getSettings,
  listAuditLog,
  settingsSection,
  testSettings,
  updateSettings,
} from '@app/contracts/platform';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ListAuditLog } from '../application/audit-log.js';
import type {
  GetPublicConfig,
  GetSettings,
  TestSettings,
  UpdateSettingsSection,
} from '../application/settings-use-cases.js';

export interface PlatformRouteDeps {
  getSettings: GetSettings;
  updateSettingsSection: UpdateSettingsSection;
  testSettings: TestSettings;
  getPublicConfig: GetPublicConfig;
  listAuditLog: ListAuditLog;
}

/** FR-7, FR-8, FR-9 endpoints (PRD section 7, Platform). Staff checks live in the use cases. */
export function platformRoutes(app: FastifyInstance, deps: PlatformRouteDeps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    routePath(getPublicConfig),
    { schema: { tags: ['platform'], response: { 200: getPublicConfig.response } } },
    () => deps.getPublicConfig.execute(),
  );

  api.get(
    routePath(getSettings),
    {
      preHandler: app.authenticate,
      schema: { tags: ['platform'], response: { 200: getSettings.response } },
    },
    (req) => deps.getSettings.execute({ actor: req.actor }),
  );

  for (const section of settingsSection.options) {
    const contract = updateSettings[section];
    api.put(
      routePath(contract),
      {
        preHandler: app.authenticate,
        schema: { tags: ['platform'], body: contract.body, response: { 200: contract.response } },
      },
      (req) =>
        deps.updateSettingsSection.execute({
          actor: req.actor,
          section,
          input: req.body,
        }),
    );
  }

  api.post(
    routePath(testSettings),
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['platform'],
        body: testSettings.body,
        response: { 200: testSettings.response },
      },
    },
    (req) =>
      deps.testSettings.execute({ actor: req.actor, target: req.body.target, to: req.body.to }),
  );

  api.get(
    routePath(listAuditLog),
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['platform'],
        querystring: listAuditLog.query,
        response: { 200: listAuditLog.response },
      },
    },
    (req) => {
      const { cursor, limit, businessId, staffMemberId, action } = req.query;
      return deps.listAuditLog.execute({
        actor: req.actor,
        filter: { businessId, staffMemberId, action },
        cursor,
        limit,
      });
    },
  );
}
