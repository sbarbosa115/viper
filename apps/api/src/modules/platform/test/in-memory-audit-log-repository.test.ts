import { auditLogRepositoryContract } from './audit-log-repository-contract.js';
import { InMemoryAuditLogRepository } from './fakes.js';

auditLogRepositoryContract('in-memory', () => new InMemoryAuditLogRepository());
