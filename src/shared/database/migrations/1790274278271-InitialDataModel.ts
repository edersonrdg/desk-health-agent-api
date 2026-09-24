import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 003: tenant, patient, service, appointment, inbox and outbox.
 * Hand-written (D7). The professional/slot_hold exclusion constraint comes
 * with the scheduling spec (D1).
 */
export class InitialDataModel1790274278271 implements MigrationInterface {
  name = 'InitialDataModel1790274278271';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "service_type" AS ENUM ('consultation', 'exam', 'procedure')`,
    );
    await queryRunner.query(
      `CREATE TYPE "appointment_status" AS ENUM ('booked', 'confirmed', 'cancelled', 'completed', 'no_show')`,
    );
    await queryRunner.query(
      `CREATE TYPE "appointment_source" AS ENUM ('whatsapp_agent', 'staff', 'external_sync')`,
    );

    await queryRunner.query(`
      CREATE TABLE "tenant" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "timezone" text NOT NULL,
        "locale" text NOT NULL DEFAULT 'pt-BR',
        "policies" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tenant" PRIMARY KEY ("id"),
        CONSTRAINT "chk_tenant_locale" CHECK ("locale" IN ('pt-BR', 'en', 'es'))
      )`);

    await queryRunner.query(`
      CREATE TABLE "patient" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "whatsapp_id" text NOT NULL,
        "name" text NOT NULL,
        "dob" date,
        "national_id" bytea,
        "national_id_hash" bytea,
        "insurance" jsonb,
        "consent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_patient" PRIMARY KEY ("id"),
        CONSTRAINT "fk_patient_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenant" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_patient_tenant_whatsapp" UNIQUE ("tenant_id", "whatsapp_id"),
        CONSTRAINT "chk_patient_national_id_pair"
          CHECK (("national_id" IS NULL) = ("national_id_hash" IS NULL))
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_patient_tenant_national_id_hash"
        ON "patient" ("tenant_id", "national_id_hash")
        WHERE "national_id_hash" IS NOT NULL`);

    await queryRunner.query(`
      CREATE TABLE "service" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" text NOT NULL,
        "type" "service_type" NOT NULL,
        "duration_minutes" integer NOT NULL,
        "preparation" text,
        "price_cents" integer,
        "currency" char(3) NOT NULL DEFAULT 'BRL',
        "required_sequence" uuid[] NOT NULL DEFAULT '{}',
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_service" PRIMARY KEY ("id"),
        CONSTRAINT "fk_service_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenant" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_service_tenant_name" UNIQUE ("tenant_id", "name"),
        CONSTRAINT "chk_service_duration_positive" CHECK ("duration_minutes" > 0),
        CONSTRAINT "chk_service_price_non_negative"
          CHECK ("price_cents" IS NULL OR "price_cents" >= 0)
      )`);

    await queryRunner.query(`
      CREATE TABLE "appointment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "patient_id" uuid NOT NULL,
        "service_id" uuid NOT NULL,
        "range" tstzrange NOT NULL,
        "status" "appointment_status" NOT NULL DEFAULT 'booked',
        "source" "appointment_source" NOT NULL,
        "external_ref" text,
        "version" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_appointment" PRIMARY KEY ("id"),
        CONSTRAINT "fk_appointment_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenant" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_appointment_patient" FOREIGN KEY ("patient_id")
          REFERENCES "patient" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_appointment_service" FOREIGN KEY ("service_id")
          REFERENCES "service" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_appointment_range_bounds" CHECK (
          NOT isempty("range") AND lower_inc("range") AND NOT upper_inc("range")
          AND NOT lower_inf("range") AND NOT upper_inf("range")
        )
      )`);
    await queryRunner.query(
      `CREATE INDEX "ix_appointment_tenant_patient" ON "appointment" ("tenant_id", "patient_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_appointment_tenant_service" ON "appointment" ("tenant_id", "service_id")`,
    );

    for (const table of ['inbox_message', 'outbox_message']) {
      await queryRunner.query(`
        CREATE TABLE "${table}" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "tenant_id" uuid NOT NULL,
          "external_id" text NOT NULL,
          "event_type" text NOT NULL,
          "payload" bytea NOT NULL,
          "published_at" timestamptz,
          "attempts" integer NOT NULL DEFAULT 0,
          "last_error" text,
          "created_at" timestamptz NOT NULL DEFAULT now(),
          "updated_at" timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT "pk_${table}" PRIMARY KEY ("id"),
          CONSTRAINT "fk_${table}_tenant" FOREIGN KEY ("tenant_id")
            REFERENCES "tenant" ("id") ON DELETE CASCADE,
          CONSTRAINT "uq_${table}_tenant_external_id" UNIQUE ("tenant_id", "external_id")
        )`);
      await queryRunner.query(`
        CREATE INDEX "ix_${table}_unpublished" ON "${table}" ("created_at")
          WHERE "published_at" IS NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "outbox_message"`);
    await queryRunner.query(`DROP TABLE "inbox_message"`);
    await queryRunner.query(`DROP TABLE "appointment"`);
    await queryRunner.query(`DROP TABLE "service"`);
    await queryRunner.query(`DROP TABLE "patient"`);
    await queryRunner.query(`DROP TABLE "tenant"`);
    await queryRunner.query(`DROP TYPE "appointment_source"`);
    await queryRunner.query(`DROP TYPE "appointment_status"`);
    await queryRunner.query(`DROP TYPE "service_type"`);
  }
}
