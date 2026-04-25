import { describe, it, expect } from 'bun:test';
import * as schema from '../schema';

describe('Database Schema', () => {
  describe('Tables', () => {
    it('exports all 8 table definitions', () => {
      expect(schema.adminUsers).toBeDefined();
      expect(schema.customers).toBeDefined();
      expect(schema.policies).toBeDefined();
      expect(schema.claims).toBeDefined();
      expect(schema.claimEvents).toBeDefined();
      expect(schema.callSessions).toBeDefined();
      expect(schema.transcripts).toBeDefined();
      expect(schema.evidence).toBeDefined();
    });

    it('adminUsers has correct columns', () => {
      const cols = Object.keys(schema.adminUsers);
      expect(cols).toContain('id');
      expect(cols).toContain('email');
      expect(cols).toContain('role');
    });

    it('customers has correct columns', () => {
      const cols = Object.keys(schema.customers);
      expect(cols).toContain('id');
      expect(cols).toContain('phone');
      expect(cols).toContain('firstName');
      expect(cols).toContain('lastName');
    });

    it('policies references customers', () => {
      expect(schema.policies.customerId).toBeDefined();
    });

    it('claims references customers and policies', () => {
      expect(schema.claims.customerId).toBeDefined();
      expect(schema.claims.policyId).toBeDefined();
    });

    it('callSessions has twilioCallSid', () => {
      expect(schema.callSessions.twilioCallSid).toBeDefined();
    });

    it('transcripts has role enum', () => {
      expect(schema.transcripts.role).toBeDefined();
    });

    it('evidence has uploadToken', () => {
      expect(schema.evidence.uploadToken).toBeDefined();
    });
  });

  describe('Enums', () => {
    it('exports all enum definitions', () => {
      expect(schema.adminRoleEnum).toBeDefined();
      expect(schema.policyTypeEnum).toBeDefined();
      expect(schema.policyStatusEnum).toBeDefined();
      expect(schema.claimStatusEnum).toBeDefined();
      expect(schema.claimEventTypeEnum).toBeDefined();
      expect(schema.callStatusEnum).toBeDefined();
      expect(schema.transcriptRoleEnum).toBeDefined();
      expect(schema.evidenceFileTypeEnum).toBeDefined();
      expect(schema.evidenceStatusEnum).toBeDefined();
    });

    it('claimStatus has all expected values', () => {
      const values = schema.claimStatusEnum.enumValues;
      expect(values).toContain('draft');
      expect(values).toContain('gathering_info');
      expect(values).toContain('submitted');
      expect(values).toContain('approved');
      expect(values).toContain('denied');
    });

    it('policyType has all expected values', () => {
      const values = schema.policyTypeEnum.enumValues;
      expect(values).toContain('auto');
      expect(values).toContain('health');
      expect(values).toContain('home');
      expect(values).toContain('life');
    });
  });

  describe('Types', () => {
    it('exports inferred types', () => {
      const _customer: schema.Customer | undefined = undefined;
      const _policy: schema.Policy | undefined = undefined;
      const _claim: schema.Claim | undefined = undefined;
      const _session: schema.CallSession | undefined = undefined;
      const _transcript: schema.Transcript | undefined = undefined;
      const _evidence: schema.Evidence | undefined = undefined;
      expect(true).toBe(true);
    });
  });

  describe('Relations', () => {
    it('exports customer relations', () => {
      expect(schema.customersRelations).toBeDefined();
    });
    it('exports policy relations', () => {
      expect(schema.policiesRelations).toBeDefined();
    });
    it('exports claim relations', () => {
      expect(schema.claimsRelations).toBeDefined();
    });
    it('exports callSession relations', () => {
      expect(schema.callSessionsRelations).toBeDefined();
    });
  });
});
