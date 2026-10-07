# Coaching content sign-off — release gate (UX-11R.1)

Generated from the versioned sources of manifest `session-model-v2.5` by `web/scripts/generate-coaching-signoff-inventory.mts`.
Every entry below is currently **PROVISIONAL — coaching validation required** (`validationStatus: "PROVISIONAL"` in code). Total: 275 entries.

**Gate rule.** V2 content may reach athletes beyond an internal pilot only once every entry is `validated` (or `rejected` and replaced by a new
catalogue version, itself reviewed). Status values: `pending` · `validated` · `rejected`. Reviewer and date are filled in by the human
reviewer only: code never marks an entry validated and never invents a reviewer. A validated entry is tied to the version shown in its
section; a change of value means a new catalogue version and a new review. Turning `validationStatus` to `VALIDATED` in code is a
separate, reviewed change that follows this document, never the reverse.

Manifest components: aggregate `session-model-v2.5` · exercises `session-exercises-v2.1` · drills `session-drills-v2.0` · intents `session-intents-v2.0` · protocols `session-protocols-v2.0` · texts `coaching-text-v1.0` · templates `strength-templates-v2.1` · strengthDoses `strength-doses-v2.1` · planDosePolicy `plan-dose-policy-v2.3`.

## Strength templates

Version : `strength-templates-v2.1` · Source : `planning-engine/src/catalog/strengthTemplateCatalogV2.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `strength_lower_beginner_v1` | STRENGTH_LOWER · beginner · warm-up: hip_90_90×1, knee_to_wall_ankle×1, bird_dog×2 · work: main/principal[bodyweight_squat]; complementary/secondary[glute_bridge]; complementary/unilateral[reverse_lunge] | pending | | | |
| `strength_lower_intermediate_v1` | STRENGTH_LOWER · intermediate · warm-up: hip_90_90×1, knee_to_wall_ankle×1, bird_dog×2 · work: main/principal[goblet_squat > bodyweight_squat]; complementary/secondary[dumbbell_romanian_deadlift > dumbbell_hip_thrust > glute_bridge]; complementary/unilateral[bulgarian_split_squat > step_up > single_leg_romanian_deadlift > reverse_lunge] | pending | | | |
| `strength_lower_advanced_v1` | STRENGTH_LOWER · advanced · warm-up: hip_90_90×1, knee_to_wall_ankle×1, bird_dog×2 · work: main/principal[barbell_back_squat > barbell_deadlift > goblet_squat > bodyweight_squat]; complementary/secondary[barbell_romanian_deadlift > dumbbell_romanian_deadlift > dumbbell_hip_thrust > glute_bridge]; complementary/unilateral[bulgarian_split_squat > step_up > single_leg_romanian_deadlift > reverse_lunge] | pending | | | |
| `strength_upper_beginner_v1` | STRENGTH_UPPER · beginner · warm-up: thoracic_rotation_mobility×1, wrist_mobility×1, bear_crawl×2 · work: main/principal[pushup]; complementary/secondary[resistance_band_row > floor_ytw_raise]; complementary/prevention[dead_bug] | pending | | | |
| `strength_upper_intermediate_v1` | STRENGTH_UPPER · intermediate · warm-up: thoracic_rotation_mobility×1, wrist_mobility×1, bear_crawl×2 · work: main/principal[dumbbell_bench_press > pushup]; complementary/secondary[one_arm_dumbbell_row > lat_pulldown > inverted_row > resistance_band_row > floor_ytw_raise]; complementary/prevention[pallof_press > dead_bug] | pending | | | |
| `strength_upper_advanced_v1` | STRENGTH_UPPER · advanced · warm-up: thoracic_rotation_mobility×1, wrist_mobility×1, bear_crawl×2 · work: main/principal[barbell_bench_press > dumbbell_bench_press > pull_up > pushup]; complementary/secondary[lat_pulldown > one_arm_dumbbell_row > inverted_row > resistance_band_row > floor_ytw_raise]; complementary/prevention[hanging_leg_raise > pallof_press > dead_bug] | pending | | | |

## Strength doses

Version : `strength-doses-v2.1` · Source : `planning-engine/src/catalog/strengthDoseCatalogV2.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `MODERATE.principal` | 4 sets × 6–8 reps · RPE 7–8 · rest 120–180 s | pending | | | |
| `MODERATE.secondary` | 3 sets × 8–12 reps · RPE 7 · rest 90 s | pending | | | |
| `MODERATE.unilateral` | 3 sets × 8–10 reps · RPE 7 · rest 60–90 s | pending | | | |
| `MODERATE.prevention` | 2 sets × {"source":"exercise_reference"} · RPE 6–7 · rest 45–60 s | pending | | | |
| `LIGHT.principal` | 3 sets × 8–10 reps · RPE 5–6 · rest 90–120 s | pending | | | |
| `LIGHT.secondary` | 2 sets × 10–12 reps · RPE 5–6 · rest 60–90 s | pending | | | |
| `LIGHT.unilateral` | 2 sets × 8–10 reps · RPE 5–6 · rest 60 s | pending | | | |
| `LIGHT.prevention` | 2 sets × {"source":"exercise_reference"} · RPE 5–6 · rest 45–60 s | pending | | | |

## Plan dose policy (incl. DH duration and DH passes per phase, endurance durations, Force durations)

Version : `plan-dose-policy-v2.3` · Source : `planning-engine/src/catalog/planDosePolicyV2.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `development.forceLoad` | MODERATE | pending | | | |
| `development.forceDurationMin` | 60 | pending | | | |
| `development.dhLoad` | MODERATE | pending | | | |
| `development.dhDurationMin` | 90 | pending | | | |
| `development.dhFocusedPasses` | 6 | pending | | | |
| `development.aerobicLoad` | MODERATE | pending | | | |
| `development.aerobicBaseDurationMin` | 45 | pending | | | |
| `taper.forceLoad` | LIGHT | pending | | | |
| `taper.forceDurationMin` | 45 | pending | | | |
| `taper.dhLoad` | LIGHT | pending | | | |
| `taper.dhDurationMin` | 60 | pending | | | |
| `taper.dhFocusedPasses` | 4 | pending | | | |
| `taper.aerobicLoad` | LIGHT | pending | | | |
| `taper.aerobicBaseDurationMin` | 45 | pending | | | |

## DH drill passes (global range)

Version : `session-drills-v2.0` · Source : `planning-engine/src/catalog/sessionDrillCatalogV2.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `DH_DRILL_PASSES_RANGE_V2` | 4–8 passes | pending | | | |

## DH drills (name, skill, tier, terrain, passes)

Version : `session-drills-v2.0` · Source : `planning-engine/src/catalog/sessionDrillCatalogV2.ts + web trainingLabels (name)`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `braking_progressive_control` | « Freinage progressif » · braking · beginner · any_groomed_trail · 4–8 passes · cue cue.braking_progressive_control · criterion criterion.braking_progressive_control · vigilances vigilance.dh_scout_first | pending | | | |
| `braking_late_entry` | « Freinage tardif, relâchement précoce » · braking · intermediate · flow_trail · 4–8 passes · cue cue.braking_late_entry · criterion criterion.braking_late_entry · vigilances vigilance.dh_scout_first | pending | | | |
| `braking_marked_zone_at_speed` | « Points de freinage à vitesse de course » · braking · advanced · technical_trail · 4–8 passes · cue cue.braking_marked_zone_at_speed · criterion criterion.braking_marked_zone_at_speed · vigilances vigilance.dh_stop_on_precision_loss | pending | | | |
| `cornering_flat_turn_precision` | « Précision de trajectoire en virage plat » · cornering · beginner · flow_trail · 4–8 passes · cue cue.cornering_flat_turn_precision · criterion criterion.cornering_flat_turn_precision | pending | | | |
| `cornering_berm_speed` | « Garder la vitesse dans les virages relevés » · cornering · intermediate · bermed_trail · 4–8 passes · cue cue.cornering_berm_speed · criterion criterion.cornering_berm_speed | pending | | | |
| `cornering_off_camber` | « Engagement en virage en dévers » · cornering · advanced · technical_trail · 4–8 passes · cue cue.cornering_off_camber · criterion criterion.cornering_off_camber · vigilances vigilance.dh_stop_on_precision_loss | pending | | | |
| `line_choice_two_line_scan` | « Repérer deux lignes et s'engager » · line_choice · beginner · technical_trail · 4–8 passes · cue cue.line_choice_two_line_scan · criterion criterion.line_choice_two_line_scan · vigilances vigilance.dh_scout_first | pending | | | |
| `line_choice_rock_garden` | « Choix de ligne dans le pierrier » · line_choice · intermediate · rock_garden · 4–8 passes · cue cue.line_choice_rock_garden · criterion criterion.line_choice_rock_garden · vigilances vigilance.dh_scout_first | pending | | | |
| `line_choice_fast_line_compare` | « Comparaison chronométrée des lignes » · line_choice · advanced · rock_garden · 4–8 passes · cue cue.line_choice_fast_line_compare · criterion criterion.line_choice_fast_line_compare · vigilances vigilance.dh_stop_on_precision_loss | pending | | | |
| `steep_terrain_controlled_roll_in` | « Entrée contrôlée en pente raide » · steep_terrain · beginner · steep_technical_trail · 4–8 passes · cue cue.steep_terrain_controlled_roll_in · criterion criterion.steep_terrain_controlled_roll_in · vigilances vigilance.dh_scout_first | pending | | | |
| `steep_terrain_body_position` | « Position du corps en pente raide » · steep_terrain · intermediate · steep_technical_trail · 4–8 passes · cue cue.steep_terrain_body_position · criterion criterion.steep_terrain_body_position · vigilances vigilance.dh_scout_first | pending | | | |
| `steep_terrain_off_brake_chute` | « Couloir raide sans freiner » · steep_terrain · advanced · steep_technical_trail · 4–8 passes · cue cue.steep_terrain_off_brake_chute · criterion criterion.steep_terrain_off_brake_chute · vigilances vigilance.dh_stop_on_precision_loss | pending | | | |
| `roots_rocks_rolling` | « Rouler sur racines et rochers » · roots_rocks · beginner · root_rock_trail · 4–8 passes · cue cue.roots_rocks_rolling · criterion criterion.roots_rocks_rolling | pending | | | |
| `roots_rocks_unweighted_line` | « Ligne délestée sur racines et rochers » · roots_rocks · intermediate · root_rock_trail · 4–8 passes · cue cue.roots_rocks_unweighted_line · criterion criterion.roots_rocks_unweighted_line | pending | | | |
| `roots_rocks_committed` | « Racines et rochers engagés, à vitesse » · roots_rocks · advanced · root_rock_trail · 4–8 passes · cue cue.roots_rocks_committed · criterion criterion.roots_rocks_committed · vigilances vigilance.dh_stop_on_precision_loss | pending | | | |
| `jumps_table_top_basic` | « Bases des table-tops » · jumps · beginner · bike_park_jump_line · 4–8 passes · cue cue.jumps_table_top_basic · criterion criterion.jumps_table_top_basic · vigilances vigilance.dh_jumps_known_line | pending | | | |
| `jumps_linked_tables` | « Enchaîner les table-tops » · jumps · intermediate · bike_park_jump_line · 4–8 passes · cue cue.jumps_linked_tables · criterion criterion.jumps_linked_tables · vigilances vigilance.dh_jumps_known_line | pending | | | |
| `jumps_step_down` | « Confiance sur les step-downs » · jumps · advanced · bike_park_jump_line · 4–8 passes · cue cue.jumps_step_down · criterion criterion.jumps_step_down · vigilances vigilance.dh_jumps_known_line | pending | | | |
| `race_execution_section_consistency` | « Régularité chronométrée par section » · race_execution · beginner · any_groomed_trail · 4–8 passes · cue cue.race_execution_section_consistency · criterion criterion.race_execution_section_consistency | pending | | | |
| `race_execution_split_pace` | « Run fractionné à allure course » · race_execution · intermediate · technical_trail · 4–8 passes · cue cue.race_execution_split_pace · criterion criterion.race_execution_split_pace · vigilances vigilance.dh_stop_on_precision_loss | pending | | | |
| `race_execution_full_run_sim` | « Simulation de run complet » · race_execution · advanced · full_dh_track · 4–8 passes · cue cue.race_execution_full_run_sim · criterion criterion.race_execution_full_run_sim · vigilances vigilance.dh_stop_on_precision_loss | pending | | | |

## Session protocols (endurance durations, warm-up / cool-down, activity choice)

Version : `session-protocols-v2.0` · Source : `planning-engine/src/catalog/protocolCatalogV2.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `endurance_base_continuous` | {"activityOptions":["road_bike","mtb_rolling","home_trainer","running"],"vigilanceIds":[],"openQuestions":[],"protocolId":"endurance_base_continuous","scope":"session","family":"endurance","sessionKinds":["AEROBIC_BASE"],"intentId":"aerobic_base_lucidity","totalDurationMinutes":{"min":45,"max":90},"blocks":[{"role":"warm_up","optional":false,"durationMinutes":{"min":10,"max":10},"targetRpe":{"min":2,"max":3},"instructionIds":["instruction.endurance.activity_choice","instruction.endurance.warm_up_easy"],"items":[]},{"role":"main","optional":false,"durationMinutes":{"min":30,"max":75},"targetRpe":{"min":3,"max":4},"talkTestId":"instruction.endurance.talk_test_full_sentences","instructionIds":[],"items":[]},{"role":"cool_down","optional":false,"durationMinutes":{"min":5,"max":5},"targetRpe":{"min":2,"max":2},"instructionIds":["instruction.endurance.cool_down_easy"],"items":[]}]} | pending | | | |
| `endurance_intervals_3min` | {"activityOptions":["road_bike","mtb_rolling","home_trainer","running"],"vigilanceIds":[],"openQuestions":["endurance_intervals.variant_4x3_selection","endurance_intervals.warm_up_cool_down_rpe"],"protocolId":"endurance_intervals_3min","scope":"session","family":"endurance","sessionKinds":["AEROBIC_INTERVALS"],"intentId":"aerobic_repeat_efforts","totalDurationMinutes":{"min":53,"max":53},"blocks":[{"role":"warm_up","optional":false,"durationMinutes":{"min":15,"max":15},"instructionIds":["instruction.endurance.activity_choice","instruction.endurance.warm_up_easy"],"items":[]},{"role":"main","optional":false,"durationMinutes":{"min":28,"max":28},"instructionIds":["instruction.endurance.intervals_work","instruction.endurance.intervals_easy"],"items":[{"kind":"intervals","repetitions":6,"workSeconds":180,"workRpe":{"min":8,"max":8},"easySeconds":120,"variants":[{"variantId":"4x3min","repetitions":4,"autoSelectable":false}]}]},{"role":"cool_down","optional":false,"durationMinutes":{"min":10,"max":10},"instructionIds":["instruction.endurance.cool_down_easy"],"items":[]}]} | pending | | | |
| `mobility_routine_v1` | {"activityOptions":[],"vigilanceIds":["vigilance.mobility_no_forced_range"],"openQuestions":["mobility_routine.slow_calf_raise","mobility_routine.total_25_min_pending_dose_validation"],"protocolId":"mobility_routine_v1","scope":"session","family":"mobility","sessionKinds":["MOBILITY"],"intentId":"mobility_on_bike_range","totalDurationMinutes":{"min":22,"max":30},"blocks":[{"role":"main","focus":"hips","optional":false,"durationMinutes":{"min":9,"max":11},"instructionIds":["instruction.mobility.slow_and_breathe"],"items":[{"kind":"exercise","exerciseId":"hip_90_90","exerciseRole":"mobility"},{"kind":"exercise","exerciseId":"hip_flexor_mobility","exerciseRole":"mobility"},{"kind":"exercise","exerciseId":"deep_squat_hold","exerciseRole":"mobility"}]},{"role":"main","focus":"ankles","optional":false,"durationMinutes":{"min":3,"max":4},"instructionIds":[],"items":[{"kind":"exercise","exerciseId":"knee_to_wall_ankle","exerciseRole":"mobility"}]},{"role":"main","focus":"spine","optional":false,"durationMinutes":{"min":5,"max":7},"instructionIds":[],"items":[{"kind":"exercise","exerciseId":"cat_cow","exerciseRole":"mobility"},{"kind":"exercise","exerciseId":"thoracic_rotation_mobility","exerciseRole":"mobility"}]},{"role":"main","focus":"wrists","optional":false,"durationMinutes":{"min":2,"max":3},"instructionIds":[],"items":[{"kind":"exercise","exerciseId":"wrist_mobility","exerciseRole":"mobility"}]},{"role":"cool_down","focus":"breathing","optional":false,"durationMinutes":{"min":3,"max":5},"instructionIds":[],"items":[{"kind":"exercise","exerciseId":"breathing_long_exhale","exerciseRole":"cool_down"}]}]} | pending | | | |
| `recovery_active_v1` | {"activityOptions":[],"vigilanceIds":["vigilance.mobility_no_forced_range"],"openQuestions":["recovery_active.activity_options"],"protocolId":"recovery_active_v1","scope":"session","family":"recovery","sessionKinds":["RECOVERY_ACTIVE"],"intentId":"recovery_without_fatigue","totalDurationMinutes":{"min":20,"max":55},"blocks":[{"role":"main","optional":false,"durationMinutes":{"min":20,"max":40},"targetRpe":{"min":2,"max":3},"instructionIds":["instruction.recovery.very_easy_activity"],"items":[]},{"role":"complementary","focus":"mobility","optional":true,"durationMinutes":{"min":5,"max":10},"instructionIds":["instruction.recovery.light_mobility"],"items":[{"kind":"exercise","exerciseId":"cat_cow","exerciseRole":"recovery"},{"kind":"exercise","exerciseId":"hip_90_90","exerciseRole":"recovery"},{"kind":"exercise","exerciseId":"thoracic_rotation_mobility","exerciseRole":"recovery"}]},{"role":"cool_down","focus":"breathing","optional":true,"durationMinutes":{"min":3,"max":5},"instructionIds":[],"items":[{"kind":"exercise","exerciseId":"breathing_long_exhale","exerciseRole":"recovery"}]}]} | pending | | | |
| `strength_warm_up_v1` | {"activityOptions":[],"vigilanceIds":[],"openQuestions":["strength_warm_up.main_movement_ramp_sets","strength_warm_up.candidates_by_session_kind"],"protocolId":"strength_warm_up_v1","scope":"block_template","family":"strength","sessionKinds":["STRENGTH_LOWER","STRENGTH_UPPER","STRENGTH_FULL_LIGHT","GRIP_WORK"],"intentId":null,"totalDurationMinutes":{"min":6,"max":8},"blocks":[{"role":"warm_up","focus":"mobility","optional":false,"durationMinutes":{"min":3,"max":4},"instructionIds":["instruction.strength_warm_up.mobility"],"items":[{"kind":"exercise_choice","exerciseRole":"warm_up","count":{"min":1,"max":2},"candidates":["hip_90_90","worlds_greatest_stretch","hip_flexor_mobility","thoracic_rotation_mobility","cat_cow","knee_to_wall_ankle","wrist_mobility"]}]},{"role":"warm_up","focus":"activation","optional":false,"durationMinutes":{"min":3,"max":4},"instructionIds":["instruction.strength_warm_up.activation"],"items":[{"kind":"exercise_choice","exerciseRole":"activation","count":{"min":1,"max":2},"candidates":["glute_bridge","dead_bug","bird_dog","bear_crawl"]}]},{"role":"warm_up","focus":"main_movement_prep","optional":false,"instructionIds":["instruction.strength_warm_up.main_movement_ramp"],"items":[]}],"exerciseCount":{"min":3,"max":4}} | pending | | | |

## Endurance activity labels

Version : `session-protocols-v2.0` · Source : `web/src/features/finalPrescriptionV2/sessionModelV2Support.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `activity.road_bike` | Vélo de route | pending | | | |
| `activity.mtb_rolling` | VTT roulant | pending | | | |
| `activity.home_trainer` | Home-trainer | pending | | | |
| `activity.running` | Course à pied | pending | | | |

## Exercises (name, measure, reference prescription, roles, tiers)

Version : `session-exercises-v2.1` · Source : `planning-engine/src/catalog/sessionExerciseCatalogV2.ts + web trainingLabels (name)`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `bodyweight_squat` | « Squat au poids du corps » · reps · reference {"sets":{"min":1,"max":2},"reps":{"min":10,"max":15},"restSeconds":{"min":0,"max":30}} · roles warm_up, principal · tiers beginner | pending | | | |
| `goblet_squat` | « Goblet squat » · reps · reference {"sets":{"min":3,"max":5},"reps":{"min":6,"max":8},"restSeconds":{"min":120,"max":180}} · roles principal, secondary · tiers intermediate · vigilances vigilance.knee_pain_free_range | pending | | | |
| `barbell_back_squat` | « Squat arrière à la barre » · reps · reference {"sets":{"min":3,"max":5},"reps":{"min":6,"max":8},"restSeconds":{"min":120,"max":180}} · roles principal · tiers advanced · vigilances vigilance.back_stable_technique | pending | | | |
| `bodyweight_hip_hinge` | « Flexion de hanches au poids du corps » · reps · reference {"sets":{"min":1,"max":2},"reps":{"min":10,"max":12},"restSeconds":{"min":0,"max":30}} · roles warm_up · tiers beginner | pending | | | |
| `glute_bridge` | « Pont fessier » · reps · reference {"sets":{"min":2,"max":3},"reps":{"min":12,"max":15},"restSeconds":{"min":30,"max":45}} · roles activation, secondary · tiers beginner | pending | | | |
| `dumbbell_romanian_deadlift` | « Soulevé de terre roumain aux haltères » · reps · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":12},"restSeconds":{"min":90,"max":90}} · roles secondary, principal · tiers intermediate · vigilances vigilance.back_stop_before_rounding | pending | | | |
| `barbell_romanian_deadlift` | « Soulevé de terre roumain à la barre » · reps · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":12},"restSeconds":{"min":90,"max":90}} · roles secondary · tiers advanced · vigilances vigilance.back_stop_before_rounding | pending | | | |
| `barbell_deadlift` | « Soulevé de terre à la barre » · reps · reference {"sets":{"min":3,"max":5},"reps":{"min":6,"max":8},"restSeconds":{"min":120,"max":180}} · roles principal · tiers advanced · vigilances vigilance.back_stable_technique | pending | | | |
| `dumbbell_hip_thrust` | « Hip thrust aux haltères » · reps · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":12},"restSeconds":{"min":90,"max":90}} · roles secondary · tiers intermediate | pending | | | |
| `reverse_lunge` | « Fente arrière » · reps per side · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":12},"restSeconds":{"min":60,"max":90}} · roles unilateral · tiers beginner, intermediate · vigilances vigilance.knee_pain_free_range | pending | | | |
| `step_up` | « Montée sur banc » · reps per side · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":12},"restSeconds":{"min":60,"max":90}} · roles unilateral · tiers intermediate · vigilances vigilance.knee_pain_free_range | pending | | | |
| `bulgarian_split_squat` | « Squat bulgare » · reps per side · reference {"sets":{"min":3,"max":4},"reps":{"min":6,"max":10},"restSeconds":{"min":60,"max":90}} · roles unilateral · tiers intermediate, advanced · vigilances vigilance.knee_pain_free_range | pending | | | |
| `single_leg_romanian_deadlift` | « Soulevé de terre roumain sur une jambe » · reps per side · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":10},"restSeconds":{"min":60,"max":90}} · roles unilateral · tiers intermediate · vigilances vigilance.balance_support_allowed | pending | | | |
| `single_leg_calf_raise` | « Extension des mollets sur une jambe » · reps per side · reference {"sets":{"min":2,"max":4},"reps":{"min":12,"max":20},"restSeconds":{"min":45,"max":60}} · roles prevention · tiers beginner · vigilances vigilance.achilles_pain_free | pending | | | |
| `copenhagen_plank_short` | « Planche Copenhague courte » · duration per side · reference {"sets":{"min":2,"max":3},"durationSeconds":{"min":15,"max":30},"restSeconds":{"min":45,"max":60}} · roles prevention · tiers intermediate · vigilances vigilance.groin_stop_on_pain | pending | | | |
| `floor_ytw_raise` | « Élévations Y-T-W au sol » · reps · reference {"sets":{"min":1,"max":2},"reps":{"min":8,"max":8},"restSeconds":{"min":0,"max":30}} · roles warm_up, prevention, secondary · tiers beginner · vigilances vigilance.shoulder_pain_free | pending | | | |
| `band_pull_apart` | « Écartés à l'élastique » · reps · reference {"sets":{"min":1,"max":2},"reps":{"min":15,"max":20},"restSeconds":{"min":0,"max":30}} · roles warm_up, prevention · tiers beginner | pending | | | |
| `band_face_pull` | « Tirage visage à l'élastique » · reps · reference {"sets":{"min":2,"max":4},"reps":{"min":12,"max":15},"restSeconds":{"min":45,"max":60}} · roles prevention · tiers beginner · vigilances vigilance.shoulder_pain_free | pending | | | |
| `resistance_band_row` | « Tirage à l'élastique » · reps · reference {"sets":{"min":3,"max":4},"reps":{"min":12,"max":12},"restSeconds":{"min":90,"max":90}} · roles secondary · tiers beginner | pending | | | |
| `inverted_row` | « Tirage horizontal sous barre » · reps · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":12},"restSeconds":{"min":90,"max":90}} · roles secondary, principal · tiers intermediate · vigilances vigilance.wrist_thumb_stop_on_pain | pending | | | |
| `one_arm_dumbbell_row` | « Rowing un bras à l'haltère » · reps per side · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":12},"restSeconds":{"min":60,"max":90}} · roles unilateral, secondary · tiers intermediate | pending | | | |
| `lat_pulldown` | « Tirage vertical à la poulie » · reps · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":12},"restSeconds":{"min":90,"max":90}} · roles secondary, principal · tiers intermediate | pending | | | |
| `pull_up` | « Tractions » · reps · reference {"sets":{"min":3,"max":5},"reps":{"min":6,"max":8},"restSeconds":{"min":120,"max":180}} · roles principal · tiers advanced · vigilances vigilance.wrist_thumb_stop_on_pain, vigilance.shoulder_pain_free | pending | | | |
| `pushup` | « Pompes » · reps · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":12},"restSeconds":{"min":90,"max":90}} · roles secondary, principal, warm_up · tiers beginner · vigilances vigilance.wrist_support_alternative | pending | | | |
| `dumbbell_bench_press` | « Développé couché aux haltères » · reps · reference {"sets":{"min":3,"max":5},"reps":{"min":6,"max":8},"restSeconds":{"min":120,"max":180}} · roles principal, secondary · tiers intermediate · vigilances vigilance.shoulder_pain_free | pending | | | |
| `barbell_bench_press` | « Développé couché à la barre » · reps · reference {"sets":{"min":3,"max":5},"reps":{"min":6,"max":8},"restSeconds":{"min":120,"max":180}} · roles principal · tiers advanced · vigilances vigilance.shoulder_pain_free | pending | | | |
| `half_kneeling_dumbbell_press` | « Développé haltère à genou » · reps per side · reference {"sets":{"min":3,"max":4},"reps":{"min":8,"max":10},"restSeconds":{"min":60,"max":90}} · roles unilateral · tiers intermediate · vigilances vigilance.shoulder_pain_free | pending | | | |
| `dead_hang` | « Suspension à la barre » · duration · reference {"sets":{"min":2,"max":3},"durationSeconds":{"min":20,"max":45},"restSeconds":{"min":45,"max":60}} · roles prevention · tiers beginner, intermediate · vigilances vigilance.wrist_thumb_stop_on_pain, vigilance.grip_race_week | pending | | | |
| `farmer_carry` | « Marche du fermier » · duration · reference {"sets":{"min":3,"max":3},"durationSeconds":{"min":30,"max":40},"restSeconds":{"min":60,"max":90}} · roles prevention · tiers intermediate · vigilances vigilance.wrist_thumb_stop_on_pain, vigilance.grip_race_week | pending | | | |
| `suitcase_carry` | « Marche valise (un bras) » · duration per side · reference {"sets":{"min":3,"max":3},"durationSeconds":{"min":30,"max":30},"restSeconds":{"min":60,"max":90}} · roles prevention · tiers intermediate · vigilances vigilance.wrist_thumb_stop_on_pain | pending | | | |
| `plank` | « Gainage (planche) » · duration · reference {"sets":{"min":2,"max":3},"durationSeconds":{"min":30,"max":45},"restSeconds":{"min":45,"max":60}} · roles prevention · tiers beginner | pending | | | |
| `side_plank` | « Planche latérale » · duration per side · reference {"sets":{"min":2,"max":3},"durationSeconds":{"min":20,"max":40},"restSeconds":{"min":45,"max":60}} · roles prevention · tiers beginner · vigilances vigilance.shoulder_pain_free | pending | | | |
| `dead_bug` | « Dead bug » · reps per side · reference {"sets":{"min":2,"max":3},"reps":{"min":8,"max":10},"restSeconds":{"min":30,"max":45}} · roles activation, prevention · tiers beginner | pending | | | |
| `bird_dog` | « Bird dog » · reps per side · reference {"sets":{"min":2,"max":2},"reps":{"min":8,"max":8},"restSeconds":{"min":30,"max":30}} · roles activation · tiers beginner · vigilances vigilance.wrist_support_alternative | pending | | | |
| `pallof_press` | « Pallof press » · reps per side · reference {"sets":{"min":2,"max":4},"reps":{"min":12,"max":12},"restSeconds":{"min":45,"max":60}} · roles prevention · tiers intermediate | pending | | | |
| `hanging_leg_raise` | « Relevés de jambes suspendu » · reps · reference {"sets":{"min":2,"max":3},"reps":{"min":12,"max":15},"restSeconds":{"min":45,"max":60}} · roles prevention · tiers advanced · vigilances vigilance.wrist_thumb_stop_on_pain | pending | | | |
| `bear_crawl` | « Marche de l'ours » · duration · reference {"sets":{"min":2,"max":2},"durationSeconds":{"min":20,"max":30},"restSeconds":{"min":30,"max":45}} · roles warm_up, activation · tiers beginner · vigilances vigilance.wrist_support_alternative | pending | | | |
| `pogo_hops` | « Sauts pogo » · reps · reference {"sets":{"min":2,"max":2},"reps":{"min":15,"max":20},"restSeconds":{"min":45,"max":60}} · roles activation · tiers beginner · vigilances vigilance.achilles_pain_free | pending | | | |
| `squat_jump` | « Squat sauté » · reps · reference {"sets":{"min":3,"max":5},"reps":{"min":3,"max":5},"restSeconds":{"min":120,"max":180}} · roles explosive · tiers intermediate · vigilances vigilance.knee_pain_free_range, vigilance.power_stop_on_quality_loss | pending | | | |
| `broad_jump` | « Saut en longueur sans élan » · reps · reference {"sets":{"min":3,"max":4},"reps":{"min":3,"max":3},"restSeconds":{"min":120,"max":180}} · roles explosive · tiers intermediate · vigilances vigilance.knee_pain_free_range, vigilance.power_stop_on_quality_loss | pending | | | |
| `skater_jump` | « Sauts latéraux du patineur » · reps per side · reference {"sets":{"min":3,"max":3},"reps":{"min":3,"max":5},"restSeconds":{"min":120,"max":180}} · roles explosive · tiers intermediate · vigilances vigilance.ankle_knee_landing, vigilance.power_stop_on_quality_loss | pending | | | |
| `dumbbell_swing` | « Swing à l'haltère » · reps · reference {"sets":{"min":3,"max":4},"reps":{"min":5,"max":5},"restSeconds":{"min":120,"max":180}} · roles explosive · tiers intermediate · vigilances vigilance.back_stable_technique, vigilance.power_stop_on_quality_loss | pending | | | |
| `plyo_pushup` | « Pompes pliométriques » · reps · reference {"sets":{"min":3,"max":3},"reps":{"min":3,"max":5},"restSeconds":{"min":120,"max":180}} · roles explosive · tiers advanced · vigilances vigilance.wrist_thumb_stop_on_pain, vigilance.power_stop_on_quality_loss | pending | | | |
| `hip_flexor_mobility` | « Mobilité des fléchisseurs de hanche » · duration per side · reference {"sets":{"min":1,"max":2},"durationSeconds":{"min":45,"max":60},"restSeconds":{"min":0,"max":15}} · roles mobility, warm_up, cool_down · tiers beginner, intermediate, advanced · vigilances vigilance.mobility_no_forced_range | pending | | | |
| `thoracic_rotation_mobility` | « Mobilité thoracique en rotation » · duration per side · reference {"sets":{"min":1,"max":2},"durationSeconds":{"min":30,"max":45},"restSeconds":{"min":0,"max":15}} · roles mobility, warm_up, cool_down, recovery · tiers beginner, intermediate, advanced · vigilances vigilance.mobility_no_forced_range | pending | | | |
| `hip_90_90` | « Mobilité de hanches 90/90 » · duration per side · reference {"sets":{"min":1,"max":2},"durationSeconds":{"min":45,"max":60},"restSeconds":{"min":0,"max":15}} · roles mobility, warm_up, recovery · tiers beginner, intermediate, advanced · vigilances vigilance.mobility_no_forced_range | pending | | | |
| `deep_squat_hold` | « Squat profond tenu » · duration · reference {"sets":{"min":1,"max":2},"durationSeconds":{"min":30,"max":60},"restSeconds":{"min":0,"max":15}} · roles mobility · tiers beginner, intermediate, advanced · vigilances vigilance.mobility_no_forced_range, vigilance.knee_pain_free_range, vigilance.balance_support_allowed | pending | | | |
| `knee_to_wall_ankle` | « Genou au mur (cheville) » · duration per side · reference {"sets":{"min":1,"max":2},"durationSeconds":{"min":30,"max":45},"restSeconds":{"min":0,"max":15}} · roles mobility, warm_up · tiers beginner, intermediate, advanced · vigilances vigilance.mobility_no_forced_range, vigilance.knee_pain_free_range | pending | | | |
| `cat_cow` | « Dos rond, dos creux » · duration · reference {"sets":{"min":1,"max":2},"durationSeconds":{"min":45,"max":60},"restSeconds":{"min":0,"max":15}} · roles mobility, warm_up, cool_down, recovery · tiers beginner, intermediate, advanced · vigilances vigilance.mobility_no_forced_range, vigilance.wrist_support_alternative | pending | | | |
| `worlds_greatest_stretch` | « World's greatest stretch » · duration per side · reference {"sets":{"min":1,"max":2},"durationSeconds":{"min":30,"max":45},"restSeconds":{"min":0,"max":15}} · roles warm_up, mobility · tiers beginner, intermediate, advanced · vigilances vigilance.mobility_no_forced_range, vigilance.balance_support_allowed | pending | | | |
| `wrist_mobility` | « Mobilité des poignets » · duration · reference {"sets":{"min":1,"max":1},"durationSeconds":{"min":45,"max":60},"restSeconds":{"min":0,"max":15}} · roles mobility, warm_up · tiers beginner, intermediate, advanced · vigilances vigilance.mobility_no_forced_range, vigilance.wrist_gentle_load | pending | | | |
| `breathing_long_exhale` | « Respiration à expiration longue » · duration · reference {"sets":{"min":1,"max":1},"durationSeconds":{"min":180,"max":300},"restSeconds":{"min":0,"max":0}} · roles cool_down, recovery · tiers beginner, intermediate, advanced · vigilances vigilance.breathing_normal_if_dizzy | pending | | | |

## Session intents

Version : `session-intents-v2.0` · Source : `planning-engine/src/catalog/intentCatalogV2.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `lower_body_strength_control` | strength · STRENGTH_LOWER · text intent.lower_body_strength_control | pending | | | |
| `leg_strength_corner_exit` | strength · STRENGTH_LOWER · text intent.leg_strength_corner_exit | pending | | | |
| `leg_stability_rough_terrain` | strength · STRENGTH_LOWER · text intent.leg_stability_rough_terrain | pending | | | |
| `upper_bike_control` | strength · STRENGTH_UPPER · text intent.upper_bike_control | pending | | | |
| `strength_maintenance_light` | strength · STRENGTH_FULL_LIGHT · text intent.strength_maintenance_light | pending | | | |
| `grip_endurance_full_run` | strength · GRIP_WORK · text intent.grip_endurance_full_run | pending | | | |
| `corner_exit_power` | power · POWER · text intent.corner_exit_power | pending | | | |
| `dh_braking_control` | dh_technical · DH_TECHNICAL, DH_PERFORMANCE, DH_LIGHT, PUMPTRACK · text intent.dh_braking_control | pending | | | |
| `dh_corner_exit_speed` | dh_technical · DH_TECHNICAL, DH_PERFORMANCE, DH_LIGHT, PUMPTRACK · text intent.dh_corner_exit_speed | pending | | | |
| `dh_line_reading` | dh_technical · DH_TECHNICAL, DH_PERFORMANCE, DH_LIGHT, PUMPTRACK · text intent.dh_line_reading | pending | | | |
| `dh_steep_confidence` | dh_technical · DH_TECHNICAL, DH_PERFORMANCE, DH_LIGHT, PUMPTRACK · text intent.dh_steep_confidence | pending | | | |
| `dh_rough_terrain_flow` | dh_technical · DH_TECHNICAL, DH_PERFORMANCE, DH_LIGHT, PUMPTRACK · text intent.dh_rough_terrain_flow | pending | | | |
| `dh_jump_control` | dh_technical · DH_TECHNICAL, DH_PERFORMANCE, DH_LIGHT, PUMPTRACK · text intent.dh_jump_control | pending | | | |
| `dh_race_pace` | dh_technical · DH_TECHNICAL, DH_PERFORMANCE, DH_LIGHT, PUMPTRACK · text intent.dh_race_pace | pending | | | |
| `aerobic_base_lucidity` | endurance · AEROBIC_BASE · text intent.aerobic_base_lucidity | pending | | | |
| `aerobic_repeat_efforts` | endurance · AEROBIC_INTERVALS · text intent.aerobic_repeat_efforts | pending | | | |
| `mobility_on_bike_range` | mobility · MOBILITY · text intent.mobility_on_bike_range | pending | | | |
| `recovery_without_fatigue` | recovery · RECOVERY_ACTIVE · text intent.recovery_without_fatigue | pending | | | |

## Coaching texts — cue

Version : `coaching-text-v1.0` · Source : `planning-engine/src/catalog/coachingTextCatalog.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `cue.bodyweight_squat` | Genoux dans l'axe des pieds, talons au sol. | pending | | | |
| `cue.goblet_squat` | Haltère contre la poitrine, descends entre les talons. | pending | | | |
| `cue.barbell_back_squat` | Gaine-toi avant la descente, remonte vite. | pending | | | |
| `cue.bodyweight_hip_hinge` | Dos neutre, hanches en arrière. | pending | | | |
| `cue.glute_bridge` | Pause d'une seconde en haut, côtes basses. | pending | | | |
| `cue.dumbbell_romanian_deadlift` | Dos neutre, sens l'étirement des ischios. | pending | | | |
| `cue.barbell_romanian_deadlift` | Barre près des jambes, hanches en arrière. | pending | | | |
| `cue.barbell_deadlift` | Pousse le sol, barre collée aux jambes. | pending | | | |
| `cue.dumbbell_hip_thrust` | Épaules sur le banc, verrouille les fessiers en haut. | pending | | | |
| `cue.reverse_lunge` | Genou avant au-dessus du pied. | pending | | | |
| `cue.step_up` | Pousse avec la jambe du haut, sans élan. | pending | | | |
| `cue.bulgarian_split_squat` | Buste stable, genou dans l'axe. | pending | | | |
| `cue.single_leg_romanian_deadlift` | Bassin horizontal, dos neutre. | pending | | | |
| `cue.single_leg_calf_raise` | Monte lentement, pause en haut. | pending | | | |
| `cue.copenhagen_plank_short` | Genou sur le banc, corps aligné. | pending | | | |
| `cue.floor_ytw_raise` | Pouces vers le haut, omoplates serrées. | pending | | | |
| `cue.band_pull_apart` | Bras tendus, omoplates serrées. | pending | | | |
| `cue.band_face_pull` | Coudes hauts, termine en rotation externe. | pending | | | |
| `cue.resistance_band_row` | Tire le coude vers la hanche. | pending | | | |
| `cue.inverted_row` | Corps gainé, poitrine vers la barre. | pending | | | |
| `cue.one_arm_dumbbell_row` | Tire sans tourner le buste. | pending | | | |
| `cue.lat_pulldown` | Tire les coudes vers les côtes. | pending | | | |
| `cue.pull_up` | Pars bras tendus, poitrine vers la barre. | pending | | | |
| `cue.pushup` | Corps gainé, coudes à 45°. | pending | | | |
| `cue.dumbbell_bench_press` | Omoplates serrées, descente contrôlée. | pending | | | |
| `cue.barbell_bench_press` | Omoplates serrées, pieds au sol. | pending | | | |
| `cue.half_kneeling_dumbbell_press` | Fessier serré, côtes basses. | pending | | | |
| `cue.dead_hang` | Épaules engagées, respire. | pending | | | |
| `cue.farmer_carry` | Épaules basses, pas courts. | pending | | | |
| `cue.suitcase_carry` | Ne penche pas du côté de l'haltère. | pending | | | |
| `cue.plank` | Corps aligné, fessiers serrés. | pending | | | |
| `cue.side_plank` | Hanches hautes, corps aligné. | pending | | | |
| `cue.dead_bug` | Bas du dos collé au sol. | pending | | | |
| `cue.bird_dog` | Bassin immobile. | pending | | | |
| `cue.pallof_press` | Le buste ne tourne pas. | pending | | | |
| `cue.hanging_leg_raise` | Monte les jambes sans balancer. | pending | | | |
| `cue.bear_crawl` | Genoux proches du sol, dos plat. | pending | | | |
| `cue.pogo_hops` | Contacts courts, genoux presque tendus. | pending | | | |
| `cue.squat_jump` | Saute haut, réception silencieuse, genoux dans l'axe. | pending | | | |
| `cue.broad_jump` | Tiens la réception deux secondes. | pending | | | |
| `cue.skater_jump` | Réception stable sur une jambe. | pending | | | |
| `cue.dumbbell_swing` | La hanche lance, les bras suivent. | pending | | | |
| `cue.plyo_pushup` | Pousse le sol vite, réception bras souples. | pending | | | |
| `cue.hip_flexor_mobility` | Genou arrière au sol, bassin rentré, avance doucement les hanches sans cambrer. | pending | | | |
| `cue.thoracic_rotation_mobility` | Tourne depuis le haut du dos, bassin immobile, suis ta main du regard. | pending | | | |
| `cue.hip_90_90` | Buste droit, bascule lentement les genoux d'un côté puis de l'autre. | pending | | | |
| `cue.deep_squat_hold` | Talons au sol si possible, buste long ; tiens-toi à un appui si besoin. | pending | | | |
| `cue.knee_to_wall_ankle` | Talon au sol, amène le genou vers le mur dans l'axe du pied. | pending | | | |
| `cue.cat_cow` | Enroule puis creuse le dos lentement, au rythme de ta respiration. | pending | | | |
| `cue.worlds_greatest_stretch` | Grande fente, coude vers le pied avant, puis ouvre le bras vers le ciel. | pending | | | |
| `cue.wrist_mobility` | Cercles lents, puis appuis progressifs sur les mains. | pending | | | |
| `cue.breathing_long_exhale` | Inspire par le nez, puis expire lentement, plus longtemps que l'inspiration. | pending | | | |
| `cue.braking_progressive_control` | Serre les deux freins progressivement avant la zone marquée, sans les attraper d'un coup. | pending | | | |
| `cue.braking_late_entry` | Garde les freins jusqu'à juste avant l'entrée du virage, puis engage-toi sur ta ligne sans retoucher aux freins. | pending | | | |
| `cue.braking_marked_zone_at_speed` | Marque une courte zone de freinage avant le passage technique : freine fort uniquement là, puis relâche et passe sans freiner. | pending | | | |
| `cue.cornering_flat_turn_precision` | Choisis le point de corde marqué avant l'entrée et fais passer ta roue avant dessus. | pending | | | |
| `cue.cornering_berm_speed` | Pédale extérieure en bas, charge tôt le virage relevé et garde ton poids appuyé dedans jusqu'à la sortie. | pending | | | |
| `cue.cornering_off_camber` | Engage ton poids côté aval du vélo et continue dans la section en dévers, sans lâcher en plein virage. | pending | | | |
| `cue.line_choice_two_line_scan` | Arrête-toi au-dessus d'une courte section, choisis une des deux lignes et roule exactement celle-là à vitesse contrôlée ; prends l'autre au passage suivant. | pending | | | |
| `cue.line_choice_rock_garden` | Observe le pierrier de loin, annonce ta ligne à voix haute, puis engage-toi sans en changer. | pending | | | |
| `cue.line_choice_fast_line_compare` | Roule le même pierrier sur deux lignes différentes à vitesse course, puis garde celle qui te paraît la plus rapide et la plus fluide. Le chrono est facultatif. | pending | | | |
| `cue.steep_terrain_controlled_roll_in` | Choisis une courte pente raide, règle une vitesse lente avant l'entrée, talons bas et poids en arrière, freins en douceur. | pending | | | |
| `cue.steep_terrain_body_position` | Baisse les talons et recule ton poids à mesure que la pente se raidit, bras fléchis. | pending | | | |
| `cue.steep_terrain_off_brake_chute` | Casse ta vitesse avant le couloir, lâche les freins dans la partie la plus raide, talons bas, regard sur la sortie. | pending | | | |
| `cue.roots_rocks_rolling` | Prise légère sur le guidon, laisse le vélo bouger sous toi ; ne freine plus une fois engagé. | pending | | | |
| `cue.roots_rocks_unweighted_line` | Repère les plus grosses racines avant l'entrée, allège la roue avant sur chacune, pédales à l'horizontale. | pending | | | |
| `cue.roots_rocks_committed` | Choisis ta ligne avant l'entrée et garde ta vitesse course jusqu'au bout. | pending | | | |
| `cue.jumps_table_top_basic` | Pédales à l'horizontale, pousse de façon égale sur le kick, absorbe la réception avec les genoux. | pending | | | |
| `cue.jumps_linked_tables` | Enchaîne les table-tops sans pédaler, pompe chaque réception pour garder ta vitesse. | pending | | | |
| `cue.jumps_step_down` | Adapte ton pop à la distance et repère la réception tôt ; engage-toi sur ta vitesse. | pending | | | |
| `cue.race_execution_section_consistency` | Choisis une courte section et roule-la à un rythme que tu peux répéter : même départ, même ligne, mêmes points de freinage. Si tu as un chrono, tes temps sont une observation facultative. | pending | | | |
| `cue.race_execution_split_pace` | Choisis une section technique avec un repère à mi-parcours et roule-la en mode course depuis un départ arrêté ; après chaque passage, repère la moitié la moins fluide et corrige-la au suivant. Le chrono est facultatif. | pending | | | |
| `cue.race_execution_full_run_sim` | Roule la piste complète en mode course, du départ à l'arrivée, en gardant tes lignes jusqu'en bas. | pending | | | |

## Coaching texts — success_criterion

Version : `coaching-text-v1.0` · Source : `planning-engine/src/catalog/coachingTextCatalog.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `criterion.braking_progressive_control` | Vitesse contrôlée en douceur dans la zone de freinage, sans déraper. | pending | | | |
| `criterion.braking_late_entry` | Vitesse d'entrée gardée plus loin dans le virage, sans élargir ta trajectoire. | pending | | | |
| `criterion.braking_marked_zone_at_speed` | Freinage seulement dans la zone marquée, passage technique roulé sans freiner, à vitesse course. | pending | | | |
| `criterion.cornering_flat_turn_precision` | Roue avant à moins d'une longueur de vélo du point de corde marqué. | pending | | | |
| `criterion.cornering_berm_speed` | Sortie du virage relevé plus rapide que l'entrée, sans rattraper une glisse. | pending | | | |
| `criterion.cornering_off_camber` | Section en dévers passée sur ta ligne, sans pied posé. | pending | | | |
| `criterion.line_choice_two_line_scan` | Ligne choisie avant l'entrée tenue du début à la sortie, à vitesse contrôlée. | pending | | | |
| `criterion.line_choice_rock_garden` | Ligne annoncée avant l'entrée, puis tenue jusqu'à la sortie. | pending | | | |
| `criterion.line_choice_fast_line_compare` | Ligne retenue tenue proprement à vitesse course, sans en changer en cours de section. | pending | | | |
| `criterion.steep_terrain_controlled_roll_in` | Pente descendue à vitesse lente et régulière, sans déraper ni perdre l'avant. | pending | | | |
| `criterion.steep_terrain_body_position` | Poids centré ou en arrière selon la pente, sans perte de l'avant. | pending | | | |
| `criterion.steep_terrain_off_brake_chute` | Partie la plus raide passée sans freiner et sans perte de l'avant. | pending | | | |
| `criterion.roots_rocks_rolling` | Élan gardé sur toute la section, sans pied posé imprévu. | pending | | | |
| `criterion.roots_rocks_unweighted_line` | Section passée avec de l'élan, sans que l'avant dévie. | pending | | | |
| `criterion.roots_rocks_committed` | Section passée à une vitesse proche de la course, sur la ligne choisie. | pending | | | |
| `criterion.jumps_table_top_basic` | Décollage et réception propres, roues à plat. | pending | | | |
| `criterion.jumps_linked_tables` | Table-tops enchaînés, réceptions à plat, sans coup de frein. | pending | | | |
| `criterion.jumps_step_down` | Réception régulière et contrôlée, ni trop courte ni trop longue. | pending | | | |
| `criterion.race_execution_section_consistency` | Même départ, même ligne et mêmes points de freinage que prévu, sans chute ni pied posé. | pending | | | |
| `criterion.race_execution_split_pace` | Les deux moitiés roulées en mode course, sans relâcher dans la deuxième. | pending | | | |
| `criterion.race_execution_full_run_sim` | Descente complète en mode course, sans relâcher en fin de piste. | pending | | | |

## Coaching texts — vigilance

Version : `coaching-text-v1.0` · Source : `planning-engine/src/catalog/coachingTextCatalog.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `vigilance.knee_pain_free_range` | Genou : garde une amplitude sans douleur. | pending | | | |
| `vigilance.back_stable_technique` | Dos : technique stable avant toute hausse de difficulté. | pending | | | |
| `vigilance.back_stop_before_rounding` | Dos : arrête la descente avant que le dos s'arrondisse. | pending | | | |
| `vigilance.balance_support_allowed` | Équilibre : tu peux te tenir à un appui au début. | pending | | | |
| `vigilance.achilles_pain_free` | Tendon d'Achille : reste sans douleur. | pending | | | |
| `vigilance.groin_stop_on_pain` | Aine : arrête en cas de douleur. | pending | | | |
| `vigilance.shoulder_pain_free` | Épaule : reste sans douleur. | pending | | | |
| `vigilance.wrist_thumb_stop_on_pain` | Poignet ou pouce : prise neutre possible, arrête en cas de douleur. | pending | | | |
| `vigilance.wrist_support_alternative` | Poignet : sur les poings ou des poignées si l'appui gêne. | pending | | | |
| `vigilance.grip_race_week` | Semaine de course : pas de travail lourd de préhension. | pending | | | |
| `vigilance.power_stop_on_quality_loss` | Arrête la série dès que la hauteur ou la vitesse baisse. | pending | | | |
| `vigilance.ankle_knee_landing` | Cheville et genou : réception stable avant d'enchaîner. | pending | | | |
| `vigilance.mobility_no_forced_range` | Amplitude : va jusqu'à une tension confortable, sans forcer ni rebondir. | pending | | | |
| `vigilance.wrist_gentle_load` | Poignet : mets du poids sur les mains progressivement, reste sans douleur. | pending | | | |
| `vigilance.breathing_normal_if_dizzy` | Si la tête te tourne, reprends une respiration normale. | pending | | | |
| `vigilance.dh_scout_first` | Repère la section à vitesse réduite avant le premier passage. | pending | | | |
| `vigilance.dh_stop_on_precision_loss` | Arrête l'exercice si ta précision se dégrade nettement. | pending | | | |
| `vigilance.dh_jumps_known_line` | Sauts : seulement sur une ligne que tu connais et à ta portée. | pending | | | |

## Coaching texts — instruction

Version : `coaching-text-v1.0` · Source : `planning-engine/src/catalog/coachingTextCatalog.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `instruction.dh.brief` | Relis l'objectif et la consigne de l'exercice avant ta première descente : aujourd'hui, la qualité compte plus que la vitesse. | pending | | | |
| `instruction.dh.warm_up_easy` | Commence par des descentes faciles, sans chercher la vitesse, jusqu'à te sentir à l'aise sur le vélo. | pending | | | |
| `instruction.dh.apply_cue` | Roule des descentes complètes en appliquant la consigne de l'exercice partout où elle s'applique. Le nombre de descentes dépend du terrain et de ton temps. | pending | | | |
| `instruction.dh.debrief_and_check` | Termine par une descente facile, note ton ressenti sur l'exercice (facile, moyen, difficile) et contrôle rapidement ton vélo. | pending | | | |
| `instruction.endurance.activity_choice` | Choisis ton activité : vélo de route, VTT sur terrain roulant, home-trainer ou course à pied. | pending | | | |
| `instruction.endurance.warm_up_easy` | Commence très facilement, puis augmente progressivement ton rythme. | pending | | | |
| `instruction.endurance.talk_test_full_sentences` | Tu dois pouvoir parler en phrases complètes pendant tout l'effort. | pending | | | |
| `instruction.endurance.cool_down_easy` | Termine à allure très facile pour revenir au calme. | pending | | | |
| `instruction.endurance.intervals_work` | Pendant chaque répétition, tiens un effort soutenu et régulier, le même du début à la fin. | pending | | | |
| `instruction.endurance.intervals_easy` | Entre les répétitions, continue très facilement pour récupérer. | pending | | | |
| `instruction.mobility.slow_and_breathe` | Enchaîne les zones dans l'ordre, lentement, en respirant calmement. | pending | | | |
| `instruction.recovery.very_easy_activity` | Choisis une activité très facile et garde ce rythme du début à la fin : cette séance ne doit pas ajouter de fatigue. | pending | | | |
| `instruction.recovery.light_mobility` | Mobilité légère, sans chercher à gagner de l'amplitude. | pending | | | |
| `instruction.strength_warm_up.mobility` | Mobilise les zones que ta séance va solliciter. | pending | | | |
| `instruction.strength_warm_up.activation` | Active les muscles de ta séance, sans te fatiguer. | pending | | | |
| `instruction.strength_warm_up.main_movement_ramp` | Avant tes séries de travail, fais une ou deux séries légères de ton mouvement principal, sans fatigue. | pending | | | |

## Coaching texts — intent

Version : `coaching-text-v1.0` · Source : `planning-engine/src/catalog/coachingTextCatalog.ts`

| Content id | Current value | Status | Reviewer | Date | Note |
|---|---|---|---|---|---|
| `intent.lower_body_strength_control` | Développer la force et la stabilité des jambes utiles au contrôle du vélo. | pending | | | |
| `intent.leg_strength_corner_exit` | Développer la force qui te permet de relancer après les compressions et en sortie de virage. | pending | | | |
| `intent.leg_stability_rough_terrain` | Construire la stabilité des jambes pour rester précis dans les terrains cassants. | pending | | | |
| `intent.upper_bike_control` | Construire la force du haut du corps qui stabilise le vélo. | pending | | | |
| `intent.grip_endurance_full_run` | Tenir le guidon jusqu'en bas de la piste. | pending | | | |
| `intent.strength_maintenance_light` | Entretenir ta force sans ajouter de fatigue. | pending | | | |
| `intent.corner_exit_power` | Développer la capacité à accélérer après les sorties de virage. | pending | | | |
| `intent.dh_braking_control` | Freiner au bon endroit pour garder ta vitesse. | pending | | | |
| `intent.dh_corner_exit_speed` | Sortir des virages avec plus de vitesse. | pending | | | |
| `intent.dh_line_reading` | Lire le terrain plus tôt et choisir ta ligne. | pending | | | |
| `intent.dh_steep_confidence` | Rester maître du vélo dans les pentes raides. | pending | | | |
| `intent.dh_rough_terrain_flow` | Laisser le vélo travailler dans les racines et les rochers. | pending | | | |
| `intent.dh_jump_control` | Contrôler tes sauts de l'appel à la réception. | pending | | | |
| `intent.dh_race_pace` | Tenir une allure de course du départ à l'arrivée. | pending | | | |
| `intent.dh_race_consistency` | Répéter la section avec régularité : même ligne, mêmes repères. | pending | | | |
| `intent.aerobic_base_lucidity` | Développer ta base d'endurance pour rester lucide en fin de piste. | pending | | | |
| `intent.aerobic_repeat_efforts` | Répéter les efforts intenses sans t'éteindre. | pending | | | |
| `intent.mobility_on_bike_range` | Garder l'amplitude des hanches, des chevilles et du dos pour bouger sur le vélo. | pending | | | |
| `intent.recovery_without_fatigue` | Favoriser la récupération sans ajouter de fatigue. | pending | | | |
