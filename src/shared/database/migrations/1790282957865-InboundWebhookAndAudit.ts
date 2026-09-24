import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 004: Evolution instance → tenant mapping (D3), inbox trace id (D19)
 * and the append-only audit_event table (D30–D35). Hand-written (spec 003 D7).
 */
export class InboundWebhookAndAudit1790282957865 implements MigrationInterface {
  name = 'InboundWebhookAndAudit1790282957865';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant" ADD "evolution_instance" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant" ADD CONSTRAINT "uq_tenant_evolution_instance" UNIQUE ("evolution_instance")`,
    );

    await queryRunner.query(
      `ALTER TABLE "inbox_message" ADD "trace_id" uuid NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TYPE "audit_actor_type" AS ENUM ('agent', 'staff', 'patient', 'system')`,
    );
    await queryRunner.query(`
      CREATE TABLE "audit_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "actor_type" "audit_actor_type" NOT NULL,
        "actor_id" uuid,
        "action" text NOT NULL,
        "entity_type" text NOT NULL,
        "entity_id" uuid,
        "before" bytea,
        "after" bytea,
        "model_version" text,
        "prompt_version" text,
        "trace_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_audit_event" PRIMARY KEY ("id"),
        CONSTRAINT "fk_audit_event_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenant" ("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX "ix_audit_event_tenant_created_at" ON "audit_event" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_audit_event_tenant_entity" ON "audit_event" ("tenant_id", "entity_type", "entity_id")`,
    );

    await queryRunner.query(`
      CREATE FUNCTION "audit_event_append_only"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit_event is append-only'
          USING ERRCODE = 'restrict_violation';
      END
      $$`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_audit_event_append_only"
        BEFORE UPDATE OR DELETE ON "audit_event"
        FOR EACH ROW EXECUTE FUNCTION "audit_event_append_only"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "trg_audit_event_append_only" ON "audit_event"`,
    );
    await queryRunner.query(`DROP FUNCTION "audit_event_append_only"()`);
    await queryRunner.query(`DROP TABLE "audit_event"`);
    await queryRunner.query(`DROP TYPE "audit_actor_type"`);
    await queryRunner.query(
      `ALTER TABLE "inbox_message" DROP COLUMN "trace_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant" DROP CONSTRAINT "uq_tenant_evolution_instance"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant" DROP COLUMN "evolution_instance"`,
    );
  }
}
