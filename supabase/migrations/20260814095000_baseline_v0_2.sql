


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."completion_status" AS ENUM (
    'done',
    'partial',
    'skipped',
    'replaced'
);


ALTER TYPE "public"."completion_status" OWNER TO "postgres";


CREATE TYPE "public"."current_stage" AS ENUM (
    'U19',
    'U19_to_Elite',
    'Elite',
    'Other'
);


ALTER TYPE "public"."current_stage" OWNER TO "postgres";


CREATE TYPE "public"."fatigue_zone" AS ENUM (
    'LOW',
    'NORMAL',
    'HIGH',
    'VERY_HIGH'
);


ALTER TYPE "public"."fatigue_zone" OWNER TO "postgres";


CREATE TYPE "public"."goal_level" AS ENUM (
    'season',
    'block'
);


ALTER TYPE "public"."goal_level" OWNER TO "postgres";


CREATE TYPE "public"."goal_status" AS ENUM (
    'active',
    'achieved',
    'abandoned',
    'archived'
);


ALTER TYPE "public"."goal_status" OWNER TO "postgres";


CREATE TYPE "public"."health_flag_status" AS ENUM (
    'active',
    'monitoring',
    'resolved'
);


ALTER TYPE "public"."health_flag_status" OWNER TO "postgres";


CREATE TYPE "public"."health_flag_type" AS ENUM (
    'injury_suspect',
    'concussion_suspect',
    'illness',
    'pain_persistent',
    'other'
);


ALTER TYPE "public"."health_flag_type" OWNER TO "postgres";


CREATE TYPE "public"."pain_location_code" AS ENUM (
    'lower_back',
    'upper_back',
    'neck',
    'shoulder_L',
    'shoulder_R',
    'elbow_L',
    'elbow_R',
    'wrist_L',
    'wrist_R',
    'hand_L',
    'hand_R',
    'thumb_L',
    'thumb_R',
    'forearm_L',
    'forearm_R',
    'hip_L',
    'hip_R',
    'knee_L',
    'knee_R',
    'ankle_L',
    'ankle_R',
    'quad_L',
    'quad_R',
    'hamstring_L',
    'hamstring_R',
    'calf_L',
    'calf_R',
    'groin',
    'chest',
    'abs',
    'head',
    'other'
);


ALTER TYPE "public"."pain_location_code" OWNER TO "postgres";


CREATE TYPE "public"."race_format" AS ENUM (
    'HOT_TRAIL_2DAY',
    'IXS_3DAY',
    'SWISS_CUP',
    'UCI_WC',
    'UCI_WORLDS',
    'OTHER'
);


ALTER TYPE "public"."race_format" OWNER TO "postgres";


CREATE TYPE "public"."race_priority" AS ENUM (
    'A_PLUS',
    'A',
    'B',
    'C'
);


ALTER TYPE "public"."race_priority" OWNER TO "postgres";


CREATE TYPE "public"."race_status" AS ENUM (
    'planned',
    'registered',
    'confirmed',
    'completed',
    'skipped',
    'cancelled'
);


ALTER TYPE "public"."race_status" OWNER TO "postgres";


CREATE TYPE "public"."readiness_zone" AS ENUM (
    'GREEN',
    'AMBER',
    'RED'
);


ALTER TYPE "public"."readiness_zone" OWNER TO "postgres";


CREATE TYPE "public"."session_source" AS ENUM (
    'rule',
    'manual',
    'template'
);


ALTER TYPE "public"."session_source" OWNER TO "postgres";


CREATE TYPE "public"."session_type" AS ENUM (
    'STRENGTH_A',
    'STRENGTH_B',
    'AEROBIC_BASE',
    'AEROBIC_INTERVALS',
    'DH_TECHNICAL',
    'DH_PERFORMANCE',
    'RECOVERY',
    'REST',
    'BIKE_MAINTENANCE',
    'RACE_PREP'
);


ALTER TYPE "public"."session_type" OWNER TO "postgres";


CREATE TYPE "public"."training_mode" AS ENUM (
    'RACE_WEEK',
    'RACE_CLUSTER',
    'OFF_SEASON_RECOVERY',
    'OFF_SEASON_DEVELOPMENT',
    'PRE_SEASON',
    'IN_SEASON',
    'INJURY_RECOVERY',
    'OTHER'
);


ALTER TYPE "public"."training_mode" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_session_load"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.actual_duration_min IS NOT NULL AND NEW.rpe IS NOT NULL THEN
    NEW.session_load := (NEW.actual_duration_min * NEW.rpe) / 10.0;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."compute_session_load"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."athlete_baselines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "measured_date" "date" NOT NULL,
    "is_current" boolean DEFAULT false NOT NULL,
    "bodyweight_kg" numeric(5,2),
    "height_cm" numeric(5,1),
    "squat_1rm_kg" numeric(5,1),
    "deadlift_1rm_kg" numeric(5,1),
    "deadlift_variant" "text",
    "bench_1rm_kg" numeric(5,1),
    "pullups_max_bw" integer,
    "pullups_max_weighted_kg" numeric(5,1),
    "dead_hang_max_sec" integer,
    "farmer_walk_max_meters" integer,
    "farmer_walk_load_kg" numeric(5,1),
    "ftp_watts" integer,
    "hr_max_bpm" integer,
    "measurement_context" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "measurement_id" "text" NOT NULL
);


ALTER TABLE "public"."athlete_baselines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."athlete_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "state_date" "date" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "readiness_score" numeric(4,3),
    "readiness_zone" "public"."readiness_zone",
    "fatigue_load_7d" numeric(6,2),
    "fatigue_zone" "public"."fatigue_zone",
    "days_since_last_dh" integer,
    "days_to_next_important_dh" integer,
    "days_to_next_a_race" integer,
    "days_to_next_b_race" integer,
    "active_health_flags" integer DEFAULT 0 NOT NULL,
    "risk_flags" "jsonb" DEFAULT '[]'::"jsonb",
    "source_checkin_id" "uuid",
    "active_mode" "public"."training_mode"
);


ALTER TABLE "public"."athlete_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."athletes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "dob" "date",
    "region" "text",
    "nationality" "text" DEFAULT 'CH'::"text",
    "current_stage" "public"."current_stage" DEFAULT 'Elite'::"public"."current_stage" NOT NULL,
    "discipline" "text" DEFAULT 'DH_MTB'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."athletes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."completed_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "planned_session_id" "uuid",
    "decision_id" "uuid",
    "session_date" "date" NOT NULL,
    "session_type" "public"."session_type" NOT NULL,
    "completion_status" "public"."completion_status" NOT NULL,
    "actual_duration_min" integer,
    "rpe" integer,
    "session_load" numeric(6,2),
    "main_content" "jsonb",
    "free_notes" "text",
    "post_leg_fatigue" integer,
    "post_grip_fatigue" integer,
    "new_pain" boolean DEFAULT false NOT NULL,
    "new_pain_note" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "completed_sessions_actual_duration_min_check" CHECK (("actual_duration_min" >= 0)),
    CONSTRAINT "completed_sessions_post_grip_fatigue_check" CHECK ((("post_grip_fatigue" >= 0) AND ("post_grip_fatigue" <= 10))),
    CONSTRAINT "completed_sessions_post_leg_fatigue_check" CHECK ((("post_leg_fatigue" >= 0) AND ("post_leg_fatigue" <= 10))),
    CONSTRAINT "completed_sessions_rpe_check" CHECK ((("rpe" >= 0) AND ("rpe" <= 10)))
);


ALTER TABLE "public"."completed_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_checkins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "checkin_date" "date" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sleep_hours" numeric(3,1),
    "sleep_quality" integer,
    "energy" integer,
    "work_stress" integer,
    "leg_fatigue" integer,
    "grip_fatigue" integer,
    "motivation" integer,
    "pain" boolean DEFAULT false NOT NULL,
    "pain_location" "text",
    "pain_intensity" integer,
    "pain_new" boolean,
    "suspected_concussion" boolean DEFAULT false NOT NULL,
    "fever_or_illness" boolean DEFAULT false NOT NULL,
    "free_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sleep_wake_ups" integer,
    "pain_location_code" "public"."pain_location_code",
    CONSTRAINT "daily_checkins_energy_check" CHECK ((("energy" >= 0) AND ("energy" <= 10))),
    CONSTRAINT "daily_checkins_grip_fatigue_check" CHECK ((("grip_fatigue" >= 0) AND ("grip_fatigue" <= 10))),
    CONSTRAINT "daily_checkins_leg_fatigue_check" CHECK ((("leg_fatigue" >= 0) AND ("leg_fatigue" <= 10))),
    CONSTRAINT "daily_checkins_motivation_check" CHECK ((("motivation" >= 0) AND ("motivation" <= 10))),
    CONSTRAINT "daily_checkins_pain_intensity_check" CHECK ((("pain_intensity" >= 0) AND ("pain_intensity" <= 10))),
    CONSTRAINT "daily_checkins_sleep_hours_check" CHECK ((("sleep_hours" >= (0)::numeric) AND ("sleep_hours" <= (24)::numeric))),
    CONSTRAINT "daily_checkins_sleep_quality_check" CHECK ((("sleep_quality" >= 0) AND ("sleep_quality" <= 10))),
    CONSTRAINT "daily_checkins_sleep_wake_ups_check" CHECK ((("sleep_wake_ups" >= 0) AND ("sleep_wake_ups" <= 20))),
    CONSTRAINT "daily_checkins_work_stress_check" CHECK ((("work_stress" >= 0) AND ("work_stress" <= 10))),
    CONSTRAINT "pain_intensity_requires_pain" CHECK (((("pain" = false) AND ("pain_intensity" IS NULL)) OR (("pain" = true) AND ("pain_intensity" IS NOT NULL))))
);


ALTER TABLE "public"."daily_checkins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "decision_date" "date" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "planned_session_before" "public"."session_type",
    "final_session" "public"."session_type" NOT NULL,
    "session_content_ref" "text",
    "readiness_score" numeric(4,3),
    "readiness_zone" "public"."readiness_zone",
    "fatigue_load_7d" numeric(6,2),
    "fatigue_zone" "public"."fatigue_zone",
    "triggered_rules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "reason" "text" NOT NULL,
    "confidence" numeric(3,2),
    "stop_conditions" "jsonb" DEFAULT '[]'::"jsonb",
    "do_not_do" "jsonb" DEFAULT '[]'::"jsonb",
    "source_checkin_id" "uuid",
    "source_state_id" "uuid",
    "engine_version" "text" DEFAULT 'v0.1'::"text" NOT NULL,
    "overridden_by_user" boolean DEFAULT false NOT NULL,
    "override_reason" "text",
    "reviewed_after_days" integer,
    "outcome_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "decisions_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric)))
);


ALTER TABLE "public"."decisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "level" "public"."goal_level" NOT NULL,
    "label" "text" NOT NULL,
    "target_metric" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "status" "public"."goal_status" DEFAULT 'active'::"public"."goal_status" NOT NULL,
    "parent_goal_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."health_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "flag_date" "date" NOT NULL,
    "flag_type" "public"."health_flag_type" NOT NULL,
    "status" "public"."health_flag_status" DEFAULT 'active'::"public"."health_flag_status" NOT NULL,
    "description" "text" NOT NULL,
    "body_location" "text",
    "intensity" integer,
    "professional_consulted" boolean DEFAULT false NOT NULL,
    "professional_type" "text",
    "resolved_at" "date",
    "resolution_note" "text",
    "source_checkin_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "health_flags_intensity_check" CHECK ((("intensity" >= 0) AND ("intensity" <= 10)))
);


ALTER TABLE "public"."health_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."planned_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "planned_date" "date" NOT NULL,
    "session_type" "public"."session_type" NOT NULL,
    "primary_objective" "text",
    "planned_duration_min" integer,
    "planned_time_of_day" time without time zone,
    "source" "public"."session_source" DEFAULT 'manual'::"public"."session_source" NOT NULL,
    "training_block_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "planned_sessions_planned_duration_min_check" CHECK (("planned_duration_min" > 0))
);


ALTER TABLE "public"."planned_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."race_calendar" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "event_name" "text" NOT NULL,
    "series" "text",
    "country" "text",
    "location" "text",
    "category" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "priority" "public"."race_priority" DEFAULT 'B'::"public"."race_priority" NOT NULL,
    "status" "public"."race_status" DEFAULT 'planned'::"public"."race_status" NOT NULL,
    "registration_deadline" "date",
    "registration_url" "text",
    "notes" "text",
    "result_position" integer,
    "result_time_seconds" numeric(7,3),
    "result_gap_to_winner" numeric(6,3),
    "result_field_size" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "race_format" "public"."race_format",
    CONSTRAINT "valid_race_dates" CHECK (("end_date" >= "start_date"))
);


ALTER TABLE "public"."race_calendar" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "primary_focus" "text" NOT NULL,
    "secondary_focus" "text",
    "target_load_week" integer,
    "notes" "text",
    "is_current" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mode" "public"."training_mode",
    CONSTRAINT "valid_block_dates" CHECK (("end_date" >= "start_date"))
);


ALTER TABLE "public"."training_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "athlete_id" "uuid" NOT NULL,
    "week_start_date" "date" NOT NULL,
    "monday_evening" boolean DEFAULT true NOT NULL,
    "tuesday_evening" boolean DEFAULT true NOT NULL,
    "wednesday_evening" boolean DEFAULT true NOT NULL,
    "thursday_evening" boolean DEFAULT true NOT NULL,
    "friday_afternoon" boolean DEFAULT true NOT NULL,
    "friday_evening" boolean DEFAULT true NOT NULL,
    "saturday_full" boolean DEFAULT true NOT NULL,
    "sunday_full" boolean DEFAULT true NOT NULL,
    "week_context" "text",
    "travel" boolean DEFAULT false NOT NULL,
    "travel_note" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."weekly_availability" OWNER TO "postgres";


ALTER TABLE ONLY "public"."athlete_baselines"
    ADD CONSTRAINT "athlete_baselines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."athlete_state"
    ADD CONSTRAINT "athlete_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."athletes"
    ADD CONSTRAINT "athletes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."athletes"
    ADD CONSTRAINT "athletes_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."completed_sessions"
    ADD CONSTRAINT "completed_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_checkins"
    ADD CONSTRAINT "daily_checkins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decisions"
    ADD CONSTRAINT "decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_flags"
    ADD CONSTRAINT "health_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."planned_sessions"
    ADD CONSTRAINT "planned_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."race_calendar"
    ADD CONSTRAINT "race_calendar_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_blocks"
    ADD CONSTRAINT "training_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_checkins"
    ADD CONSTRAINT "unique_checkin_per_day" UNIQUE ("athlete_id", "checkin_date");



ALTER TABLE ONLY "public"."completed_sessions"
    ADD CONSTRAINT "unique_completed_per_day" UNIQUE ("athlete_id", "session_date");



ALTER TABLE ONLY "public"."athlete_baselines"
    ADD CONSTRAINT "unique_measurement_per_athlete" UNIQUE ("athlete_id", "measurement_id");



ALTER TABLE ONLY "public"."planned_sessions"
    ADD CONSTRAINT "unique_planned_per_day" UNIQUE ("athlete_id", "planned_date");



ALTER TABLE ONLY "public"."athlete_state"
    ADD CONSTRAINT "unique_state_per_day" UNIQUE ("athlete_id", "state_date");



ALTER TABLE ONLY "public"."weekly_availability"
    ADD CONSTRAINT "unique_week_per_athlete" UNIQUE ("athlete_id", "week_start_date");



ALTER TABLE ONLY "public"."weekly_availability"
    ADD CONSTRAINT "weekly_availability_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_athlete_baselines_athlete_date" ON "public"."athlete_baselines" USING "btree" ("athlete_id", "measured_date" DESC);



CREATE INDEX "idx_athlete_baselines_current" ON "public"."athlete_baselines" USING "btree" ("athlete_id", "is_current");



CREATE INDEX "idx_athlete_baselines_measurement" ON "public"."athlete_baselines" USING "btree" ("athlete_id", "measurement_id");



CREATE INDEX "idx_athlete_state_date" ON "public"."athlete_state" USING "btree" ("athlete_id", "state_date" DESC);



CREATE INDEX "idx_athletes_user_id" ON "public"."athletes" USING "btree" ("user_id");



CREATE INDEX "idx_checkins_athlete_date" ON "public"."daily_checkins" USING "btree" ("athlete_id", "checkin_date" DESC);



CREATE INDEX "idx_completed_sessions_date" ON "public"."completed_sessions" USING "btree" ("athlete_id", "session_date" DESC);



CREATE INDEX "idx_completed_sessions_type" ON "public"."completed_sessions" USING "btree" ("athlete_id", "session_type");



CREATE INDEX "idx_decisions_date" ON "public"."decisions" USING "btree" ("athlete_id", "decision_date" DESC);



CREATE INDEX "idx_decisions_engine_version" ON "public"."decisions" USING "btree" ("engine_version");



CREATE INDEX "idx_goals_athlete_status" ON "public"."goals" USING "btree" ("athlete_id", "status");



CREATE INDEX "idx_goals_level" ON "public"."goals" USING "btree" ("athlete_id", "level");



CREATE INDEX "idx_health_flags_active" ON "public"."health_flags" USING "btree" ("athlete_id", "status") WHERE ("status" = ANY (ARRAY['active'::"public"."health_flag_status", 'monitoring'::"public"."health_flag_status"]));



CREATE INDEX "idx_health_flags_date" ON "public"."health_flags" USING "btree" ("athlete_id", "flag_date" DESC);



CREATE INDEX "idx_planned_sessions_date" ON "public"."planned_sessions" USING "btree" ("athlete_id", "planned_date" DESC);



CREATE INDEX "idx_race_calendar_dates" ON "public"."race_calendar" USING "btree" ("athlete_id", "start_date");



CREATE INDEX "idx_race_calendar_priority" ON "public"."race_calendar" USING "btree" ("athlete_id", "priority", "status");



CREATE INDEX "idx_race_calendar_upcoming" ON "public"."race_calendar" USING "btree" ("athlete_id", "start_date") WHERE ("status" = ANY (ARRAY['planned'::"public"."race_status", 'registered'::"public"."race_status", 'confirmed'::"public"."race_status"]));



CREATE INDEX "idx_training_blocks_current" ON "public"."training_blocks" USING "btree" ("athlete_id", "is_current");



CREATE INDEX "idx_training_blocks_dates" ON "public"."training_blocks" USING "btree" ("athlete_id", "start_date", "end_date");



CREATE INDEX "idx_weekly_availability_athlete_week" ON "public"."weekly_availability" USING "btree" ("athlete_id", "week_start_date" DESC);



CREATE UNIQUE INDEX "unique_current_baseline_per_athlete" ON "public"."athlete_baselines" USING "btree" ("athlete_id") WHERE ("is_current" = true);



CREATE UNIQUE INDEX "unique_current_block_per_athlete" ON "public"."training_blocks" USING "btree" ("athlete_id") WHERE ("is_current" = true);



CREATE OR REPLACE TRIGGER "trg_athlete_baselines_updated_at" BEFORE UPDATE ON "public"."athlete_baselines" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_athletes_updated_at" BEFORE UPDATE ON "public"."athletes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_completed_sessions_updated_at" BEFORE UPDATE ON "public"."completed_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_compute_session_load" BEFORE INSERT OR UPDATE ON "public"."completed_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."compute_session_load"();



CREATE OR REPLACE TRIGGER "trg_daily_checkins_updated_at" BEFORE UPDATE ON "public"."daily_checkins" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_decisions_updated_at" BEFORE UPDATE ON "public"."decisions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_goals_updated_at" BEFORE UPDATE ON "public"."goals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_health_flags_updated_at" BEFORE UPDATE ON "public"."health_flags" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_planned_sessions_updated_at" BEFORE UPDATE ON "public"."planned_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_race_calendar_updated_at" BEFORE UPDATE ON "public"."race_calendar" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_training_blocks_updated_at" BEFORE UPDATE ON "public"."training_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_weekly_availability_updated_at" BEFORE UPDATE ON "public"."weekly_availability" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."athlete_baselines"
    ADD CONSTRAINT "athlete_baselines_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."athlete_state"
    ADD CONSTRAINT "athlete_state_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."athlete_state"
    ADD CONSTRAINT "athlete_state_source_checkin_id_fkey" FOREIGN KEY ("source_checkin_id") REFERENCES "public"."daily_checkins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athletes"
    ADD CONSTRAINT "athletes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."completed_sessions"
    ADD CONSTRAINT "completed_sessions_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."completed_sessions"
    ADD CONSTRAINT "completed_sessions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."completed_sessions"
    ADD CONSTRAINT "completed_sessions_planned_session_id_fkey" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_checkins"
    ADD CONSTRAINT "daily_checkins_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decisions"
    ADD CONSTRAINT "decisions_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decisions"
    ADD CONSTRAINT "decisions_source_checkin_id_fkey" FOREIGN KEY ("source_checkin_id") REFERENCES "public"."daily_checkins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decisions"
    ADD CONSTRAINT "decisions_source_state_id_fkey" FOREIGN KEY ("source_state_id") REFERENCES "public"."athlete_state"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_parent_goal_id_fkey" FOREIGN KEY ("parent_goal_id") REFERENCES "public"."goals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."health_flags"
    ADD CONSTRAINT "health_flags_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."health_flags"
    ADD CONSTRAINT "health_flags_source_checkin_id_fkey" FOREIGN KEY ("source_checkin_id") REFERENCES "public"."daily_checkins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."planned_sessions"
    ADD CONSTRAINT "planned_sessions_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."planned_sessions"
    ADD CONSTRAINT "planned_sessions_training_block_id_fkey" FOREIGN KEY ("training_block_id") REFERENCES "public"."training_blocks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."race_calendar"
    ADD CONSTRAINT "race_calendar_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_blocks"
    ADD CONSTRAINT "training_blocks_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_availability"
    ADD CONSTRAINT "weekly_availability_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE CASCADE;



ALTER TABLE "public"."athlete_baselines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "athlete_baselines_own_data" ON "public"."athlete_baselines" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."athlete_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "athlete_state_own_data" ON "public"."athlete_state" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."athletes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "athletes_own_data" ON "public"."athletes" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."completed_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "completed_sessions_own_data" ON "public"."completed_sessions" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."daily_checkins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_checkins_own_data" ON "public"."daily_checkins" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."decisions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decisions_own_data" ON "public"."decisions" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "goals_own_data" ON "public"."goals" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."health_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "health_flags_own_data" ON "public"."health_flags" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."planned_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "planned_sessions_own_data" ON "public"."planned_sessions" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."race_calendar" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "race_calendar_own_data" ON "public"."race_calendar" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."training_blocks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_blocks_own_data" ON "public"."training_blocks" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."weekly_availability" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "weekly_availability_own_data" ON "public"."weekly_availability" USING (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"())))) WITH CHECK (("athlete_id" IN ( SELECT "athletes"."id"
   FROM "public"."athletes"
  WHERE ("athletes"."user_id" = "auth"."uid"()))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_session_load"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_session_load"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_session_load"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."athlete_baselines" TO "anon";
GRANT ALL ON TABLE "public"."athlete_baselines" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_baselines" TO "service_role";



GRANT ALL ON TABLE "public"."athlete_state" TO "anon";
GRANT ALL ON TABLE "public"."athlete_state" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_state" TO "service_role";



GRANT ALL ON TABLE "public"."athletes" TO "anon";
GRANT ALL ON TABLE "public"."athletes" TO "authenticated";
GRANT ALL ON TABLE "public"."athletes" TO "service_role";



GRANT ALL ON TABLE "public"."completed_sessions" TO "anon";
GRANT ALL ON TABLE "public"."completed_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."completed_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."daily_checkins" TO "anon";
GRANT ALL ON TABLE "public"."daily_checkins" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_checkins" TO "service_role";



GRANT ALL ON TABLE "public"."decisions" TO "anon";
GRANT ALL ON TABLE "public"."decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."decisions" TO "service_role";



GRANT ALL ON TABLE "public"."goals" TO "anon";
GRANT ALL ON TABLE "public"."goals" TO "authenticated";
GRANT ALL ON TABLE "public"."goals" TO "service_role";



GRANT ALL ON TABLE "public"."health_flags" TO "anon";
GRANT ALL ON TABLE "public"."health_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."health_flags" TO "service_role";



GRANT ALL ON TABLE "public"."planned_sessions" TO "anon";
GRANT ALL ON TABLE "public"."planned_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."planned_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."race_calendar" TO "anon";
GRANT ALL ON TABLE "public"."race_calendar" TO "authenticated";
GRANT ALL ON TABLE "public"."race_calendar" TO "service_role";



GRANT ALL ON TABLE "public"."training_blocks" TO "anon";
GRANT ALL ON TABLE "public"."training_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."training_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_availability" TO "anon";
GRANT ALL ON TABLE "public"."weekly_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_availability" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







